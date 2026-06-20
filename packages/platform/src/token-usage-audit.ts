import type { TokenUsage } from '@anvio/core';
import type { StorageProvider } from '@anvio/core';
import { appendJsonl } from '@anvio/storage';
import { getMetricsRegistry } from '@anvio/observability';

export interface TokenUsageRecord {
  ts: string;
  sessionId: string;
  channel: string;
  agentId?: string;
  userId?: string;
  provider?: string;
  model?: string;
  usage: TokenUsage;
  estimatedCostUsd?: number;
}

/** Per-million-token list prices (USD) for rough cost estimates. */
const MODEL_COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

export function estimateTokenCostUsd(
  model: string | undefined,
  usage: TokenUsage,
): number | undefined {
  if (!model) return undefined;
  const rates = MODEL_COST_PER_1M[model];
  if (!rates) return undefined;
  const inputCost = (usage.inputTokens / 1_000_000) * rates.input;
  const outputCost = (usage.outputTokens / 1_000_000) * rates.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export class TokenUsageAudit {
  constructor(
    private readonly storage: StorageProvider,
    private readonly auditPath = 'audit/tokens.jsonl',
  ) {}

  async record(input: Omit<TokenUsageRecord, 'ts'>): Promise<void> {
    const estimatedCostUsd = estimateTokenCostUsd(input.model, input.usage);
    await appendJsonl(this.storage, this.auditPath, {
      ts: new Date().toISOString(),
      ...input,
      ...(estimatedCostUsd != null ? { estimatedCostUsd } : {}),
    });

    getMetricsRegistry().recordTokenUsage({
      provider: input.provider,
      model: input.model,
      channel: input.channel,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      totalTokens: input.usage.totalTokens,
      estimatedCostUsd,
    });
  }
}

export function createTokenUsageAudit(storage: StorageProvider): TokenUsageAudit {
  return new TokenUsageAudit(storage);
}
