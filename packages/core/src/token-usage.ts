import type { TokenUsage } from './types/common.js';

export const ZERO_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/**
 * Sum token counts across model iterations (does not mutate inputs).
 *
 * Cache counts are summed too. Dropping them would leave `inputTokens` still
 * carrying cache tokens with nothing to identify them, so every downstream cost
 * estimate would bill cached reads at the full input rate.
 */
export function addTokenUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  const cacheCreation =
    (base.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0);
  const cacheRead = (base.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0);
  return {
    inputTokens: base.inputTokens + delta.inputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    totalTokens: base.totalTokens + delta.totalTokens,
    ...(cacheCreation > 0 ? { cacheCreationInputTokens: cacheCreation } : {}),
    ...(cacheRead > 0 ? { cacheReadInputTokens: cacheRead } : {}),
  };
}
