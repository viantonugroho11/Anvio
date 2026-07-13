import type { TokenUsage } from './types/common.js';

export const ZERO_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/** Sum token counts across model iterations (does not mutate inputs). */
export function addTokenUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  const cacheReadTokens = (base.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0);
  const cacheCreationTokens = (base.cacheCreationTokens ?? 0) + (delta.cacheCreationTokens ?? 0);
  return {
    inputTokens: base.inputTokens + delta.inputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    totalTokens: base.totalTokens + delta.totalTokens,
    ...(cacheReadTokens > 0 && { cacheReadTokens }),
    ...(cacheCreationTokens > 0 && { cacheCreationTokens }),
  };
}
