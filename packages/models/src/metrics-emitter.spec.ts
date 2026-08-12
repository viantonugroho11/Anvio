import { describe, expect, it, beforeEach } from 'vitest';
import { getMetricsRegistry, resetMetricsRegistry } from '@anvio/observability';
import { withCallMetrics, recordStreamMetrics } from './metrics-emitter.js';

describe('metrics-emitter', () => {
  beforeEach(() => resetMetricsRegistry());

  it('records tokens, cache hits, and latency around a chat call', async () => {
    const response = await withCallMetrics('anthropic', 'claude-sonnet-4', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        model: 'claude-sonnet-4-20250514',
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 25,
        },
      };
    });

    expect(response.usage?.inputTokens).toBe(100);
    const text = getMetricsRegistry().toPrometheusText();
    expect(text).toContain('anvio_tokens_input_total');
    expect(text).toContain('anvio_tokens_cache_read_total');
    expect(text).toContain('anvio_tokens_cache_creation_total');
    expect(text).toContain('anvio_model_call_latency_ms');

    const hist = getMetricsRegistry().snapshotHistogram('anvio_model_call_latency_ms', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      channel: 'model-provider',
    });
    expect(hist?.count).toBe(1);
    expect(hist?.sum).toBeGreaterThanOrEqual(0);
  });

  it('recordStreamMetrics emits latency + tokens from an accumulated stream', () => {
    const start = Date.now() - 42;
    recordStreamMetrics(
      'openai',
      'gpt-4o',
      { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      start,
    );
    const hist = getMetricsRegistry().snapshotHistogram('anvio_model_call_latency_ms', {
      provider: 'openai',
      model: 'gpt-4o',
      channel: 'model-provider',
    });
    expect(hist?.count).toBe(1);
    expect(hist?.sum).toBeGreaterThanOrEqual(40);
  });
});
