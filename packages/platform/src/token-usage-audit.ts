import type { TokenUsage } from '@anvio/core';
import type { StorageProvider } from '@anvio/core';
import { appendJsonl } from '@anvio/storage';
import { getMetricsRegistry } from '@anvio/observability';
import { costInputFromUsage, estimateModelCostUsd } from '@anvio/models';

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
  latencyMs?: number;
}

/**
 * Cost for an audit record, delegated to the `ModelDescriptor` registry.
 *
 * This previously carried its own three-entry price table, which silently
 * disagreed with the registry and blanked the cost column of `anvio usage stats`
 * for every model not among those three. `provider` is now required to look a
 * descriptor up — descriptors are keyed on `provider:model`, since the same
 * model id is served at different prices by different hosts.
 */
export function estimateTokenCostUsd(
  provider: string | undefined,
  model: string | undefined,
  usage: TokenUsage,
): number | undefined {
  if (!provider || !model) return undefined;
  return estimateModelCostUsd(provider, model, costInputFromUsage(usage));
}

export class TokenUsageAudit {
  constructor(
    private readonly storage: StorageProvider,
    private readonly auditPath = 'audit/tokens.jsonl',
  ) {}

  async record(input: Omit<TokenUsageRecord, 'ts'>): Promise<void> {
    const estimatedCostUsd = estimateTokenCostUsd(input.provider, input.model, input.usage);
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
      cacheReadTokens: input.usage.cacheReadInputTokens,
      cacheCreationTokens: input.usage.cacheCreationInputTokens,
      estimatedCostUsd,
      latencyMs: input.latencyMs,
    });
  }
}

export function createTokenUsageAudit(storage: StorageProvider): TokenUsageAudit {
  return new TokenUsageAudit(storage);
}
