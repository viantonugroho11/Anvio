type Labels = Record<string, string>;

function labelKey(name: string, labels: Labels): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

/** In-process Prometheus-style counter/histogram registry for Anvio metrics. */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, { count: number; sum: number; min: number; max: number }>();

  incrementCounter(name: string, labels: Labels = {}, value = 1): void {
    const key = labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(name: string, labels: Labels, value: number): void {
    this.gauges.set(labelKey(name, labels), value);
  }

  recordTokenUsage(input: {
    provider?: string;
    model?: string;
    channel?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    estimatedCostUsd?: number;
    latencyMs?: number;
  }): void {
    const base = {
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      channel: input.channel ?? 'unknown',
    };
    this.incrementCounter('anvio_tokens_input_total', base, input.inputTokens);
    this.incrementCounter('anvio_tokens_output_total', base, input.outputTokens);
    this.incrementCounter('anvio_tokens_total', base, input.totalTokens);
    if (input.cacheReadTokens != null && input.cacheReadTokens > 0) {
      this.incrementCounter('anvio_tokens_cache_read_total', base, input.cacheReadTokens);
    }
    if (input.cacheCreationTokens != null && input.cacheCreationTokens > 0) {
      this.incrementCounter('anvio_tokens_cache_creation_total', base, input.cacheCreationTokens);
    }
    if (input.estimatedCostUsd != null) {
      this.incrementCounter('anvio_token_cost_usd_total', base, input.estimatedCostUsd);
    }
    if (input.latencyMs != null) {
      this.observeLatency('anvio_model_call_latency_ms', base, input.latencyMs);
      this.incrementCounter('anvio_model_calls_total', base);
    }
  }

  observeLatency(name: string, labels: Labels, valueMs: number): void {
    const key = labelKey(name, labels);
    const bucket = this.histograms.get(key) ?? { count: 0, sum: 0, min: Infinity, max: 0 };
    bucket.count += 1;
    bucket.sum += valueMs;
    bucket.min = Math.min(bucket.min, valueMs);
    bucket.max = Math.max(bucket.max, valueMs);
    this.histograms.set(key, bucket);
  }

  recordMcpRestart(serverId: string): void {
    this.incrementCounter('anvio_mcp_restarts_total', { server: serverId });
  }

  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, h] of this.histograms) {
      lines.push(`${key}_count ${h.count}`);
      lines.push(`${key}_sum ${h.sum}`);
      lines.push(`${key}_min ${h.min}`);
      lines.push(`${key}_max ${h.max}`);
    }
    return `${lines.join('\n')}\n`;
  }

  snapshotHistogram(name: string, labels: Labels = {}): { count: number; sum: number; min: number; max: number } | undefined {
    return this.histograms.get(labelKey(name, labels));
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

let globalRegistry: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!globalRegistry) globalRegistry = new MetricsRegistry();
  return globalRegistry;
}

export function resetMetricsRegistry(): void {
  globalRegistry?.reset();
  globalRegistry = null;
}
