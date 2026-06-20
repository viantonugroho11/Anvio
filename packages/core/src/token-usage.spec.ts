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
});
