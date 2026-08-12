import { describe, expect, it } from 'vitest';
import {
  estimateModelCostUsd,
  getModelDescriptor,
  listModelDescriptors,
} from './model-descriptor.js';

describe('ModelDescriptor registry', () => {
  it('returns the descriptor for a known (provider, model)', () => {
    const d = getModelDescriptor('anthropic', 'claude-sonnet-4-20250514');
    expect(d?.contextWindow).toBe(200_000);
    expect(d?.supportsTools).toBe(true);
    expect(d?.supportsCaching).toBe(true);
    expect(d?.cost?.input).toBe(3);
  });

  it('returns undefined for unknown models', () => {
    expect(getModelDescriptor('nope', 'nope')).toBeUndefined();
  });

  it('lists all descriptors', () => {
    const all = listModelDescriptors();
    expect(all.length).toBeGreaterThanOrEqual(9);
  });
});

describe('estimateModelCostUsd', () => {
  it('sums input + output at listed rates', () => {
    const usd = estimateModelCostUsd('openai', 'gpt-4o', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 1M input @ 2.5 + 1M output @ 10 = 12.5
    expect(usd).toBeCloseTo(12.5);
  });

  it('applies default cache-read discount (10% of input) when not specified', () => {
    const usd = estimateModelCostUsd('anthropic', 'claude-sonnet-4-20250514', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    // 1M cache-read @ (3 * 0.1) = 0.3
    expect(usd).toBeCloseTo(0.3);
  });

  it('applies default cache-creation premium (125% of input) when not specified', () => {
    const usd = estimateModelCostUsd('anthropic', 'claude-sonnet-4-20250514', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
    });
    // 1M cache-creation @ (3 * 1.25) = 3.75
    expect(usd).toBeCloseTo(3.75);
  });

  it('returns undefined for unknown model', () => {
    const usd = estimateModelCostUsd('nope', 'nope', {
      inputTokens: 1_000,
      outputTokens: 1_000,
    });
    expect(usd).toBeUndefined();
  });
});
