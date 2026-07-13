import { describe, expect, it } from 'vitest';
import { addTokenUsage, ZERO_TOKEN_USAGE } from './token-usage.js';

describe('addTokenUsage', () => {
  it('sums token counts across iterations', () => {
    const total = addTokenUsage(
      addTokenUsage(ZERO_TOKEN_USAGE, { inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    );
    expect(total).toEqual({ inputTokens: 300, outputTokens: 130, totalTokens: 430 });
  });

  it('sums optional cache token counts and omits them when zero', () => {
    const withCache = addTokenUsage(
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 100 },
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 50, cacheCreationTokens: 20 },
    );
    expect(withCache).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 150,
      cacheCreationTokens: 20,
    });

    const noCache = addTokenUsage(ZERO_TOKEN_USAGE, { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    expect(noCache).not.toHaveProperty('cacheReadTokens');
    expect(noCache).not.toHaveProperty('cacheCreationTokens');
  });
});
