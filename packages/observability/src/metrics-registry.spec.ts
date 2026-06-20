import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics-registry.js';

describe('MetricsRegistry', () => {
  it('records token counters and exports prometheus text', () => {
    const registry = new MetricsRegistry();
    registry.recordTokenUsage({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      channel: 'cli',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: 0.0001,
    });

    const text = registry.toPrometheusText();
    expect(text).toContain('anvio_tokens_total');
    expect(text).toContain('provider="anthropic"');
  });
});
