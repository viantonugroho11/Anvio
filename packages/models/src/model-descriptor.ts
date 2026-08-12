/**
 * Epic 12 F1 slice — ModelDescriptor registry.
 *
 * Consolidates capability + pricing metadata per (provider, model) pair.
 * Consumers:
 * - `estimateModelCostUsd` — used by SpendBudgetLedger wiring
 * - Router capability checks (e.g. skip a route if the target model doesn't support tools)
 * - CLI `anvio routing catalog` for operator visibility
 *
 * Descriptors are advisory — a missing entry means "unknown", not "unsupported".
 * The runtime still calls the provider and reports actual usage; descriptors just
 * enable pre-flight cost estimation and capability gating.
 */

export interface ModelCost {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-read tokens. Defaults to input * 0.1 (Anthropic-style) if omitted. */
  cacheRead?: number;
  /** USD per 1M cache-creation tokens. Defaults to input * 1.25 if omitted. */
  cacheCreation?: number;
}

export interface ModelDescriptor {
  provider: string;
  model: string;
  /** Total context window in tokens (input + output). */
  contextWindow: number;
  /** Maximum output tokens the model will generate in one response. */
  maxOutput: number;
  /** True if the model accepts native `tools` (function calling / tool_use). */
  supportsTools: boolean;
  /** True if the provider accepts `cache_control` breakpoints for this model. */
  supportsCaching: boolean;
  /** USD list price. Omit when unknown; consumers treat missing cost as $0 (unbilled). */
  cost?: ModelCost;
}

/** Registry — extend as models ship. Keys are provider:model composite. */
const DESCRIPTORS: ModelDescriptor[] = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    contextWindow: 200_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: true,
    cost: { input: 3, output: 15 },
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    contextWindow: 200_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: true,
    cost: { input: 15, output: 75 },
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    contextWindow: 200_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: true,
    cost: { input: 1, output: 5 },
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    contextWindow: 128_000,
    maxOutput: 16_384,
    supportsTools: true,
    supportsCaching: false,
    cost: { input: 2.5, output: 10 },
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    contextWindow: 128_000,
    maxOutput: 16_384,
    supportsTools: true,
    supportsCaching: false,
    cost: { input: 0.15, output: 0.6 },
  },
  {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    contextWindow: 1_000_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: true,
    cost: { input: 0.1, output: 0.4 },
  },
  {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
    contextWindow: 2_000_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: true,
    cost: { input: 1.25, output: 5 },
  },
  {
    provider: 'deepseek',
    model: 'deepseek-chat',
    contextWindow: 64_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: false,
    cost: { input: 0.27, output: 1.1 },
  },
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsTools: true,
    supportsCaching: false,
    cost: { input: 0.59, output: 0.79 },
  },
];

const INDEX = new Map(DESCRIPTORS.map((d) => [`${d.provider}:${d.model}`, d]));

export function getModelDescriptor(provider: string, model: string): ModelDescriptor | undefined {
  return INDEX.get(`${provider}:${model}`);
}

export function listModelDescriptors(): readonly ModelDescriptor[] {
  return DESCRIPTORS;
}

export interface CostEstimateInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Estimate USD cost for a call. Returns undefined when the descriptor or cost is unknown.
 * Cache tokens fall back to Anthropic-style defaults (read = 10% input, creation = 125% input)
 * when the descriptor's `cost` block omits them.
 */
export function estimateModelCostUsd(
  provider: string,
  model: string,
  usage: CostEstimateInput,
): number | undefined {
  const descriptor = getModelDescriptor(provider, model);
  if (!descriptor?.cost) return undefined;
  const { input, output, cacheRead, cacheCreation } = descriptor.cost;
  const effectiveCacheRead = cacheRead ?? input * 0.1;
  const effectiveCacheCreation = cacheCreation ?? input * 1.25;
  const usd =
    (usage.inputTokens / 1_000_000) * input +
    (usage.outputTokens / 1_000_000) * output +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * effectiveCacheRead +
    ((usage.cacheCreationTokens ?? 0) / 1_000_000) * effectiveCacheCreation;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
