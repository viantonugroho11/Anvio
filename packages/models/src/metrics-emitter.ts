import type { TokenUsage } from '@anvio/core';
import { getMetricsRegistry } from '@anvio/observability';

/**
 * Emit per-model-call metrics: tokens (in/out/cached), latency_ms, cost estimate.
 * Providers wrap chat/stream with `withCallMetrics(providerId, model, () => actual())`.
 */
export async function withCallMetrics<T extends { usage?: TokenUsage; model?: string }>(
  providerId: string,
  requestedModel: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const response = await fn();
  const latencyMs = Date.now() - start;
  const model = response.model ?? requestedModel ?? 'unknown';
  const usage = response.usage;

  getMetricsRegistry().recordTokenUsage({
    provider: providerId,
    model,
    channel: 'model-provider',
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheReadTokens: usage?.cacheReadInputTokens,
    cacheCreationTokens: usage?.cacheCreationInputTokens,
    latencyMs,
  });

  return response;
}

/** Same wrapper for streaming — pass the accumulated `done`-chunk usage to record on completion. */
export function recordStreamMetrics(
  providerId: string,
  model: string | undefined,
  usage: TokenUsage | undefined,
  startedAtMs: number,
): void {
  const latencyMs = Date.now() - startedAtMs;
  getMetricsRegistry().recordTokenUsage({
    provider: providerId,
    model: model ?? 'unknown',
    channel: 'model-provider',
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheReadTokens: usage?.cacheReadInputTokens,
    cacheCreationTokens: usage?.cacheCreationInputTokens,
    latencyMs,
  });
}
