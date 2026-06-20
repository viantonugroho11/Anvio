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
    estimatedCostUsd?: number;
  }): void {
    const base = {
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      channel: input.channel ?? 'unknown',
    };
    this.incrementCounter('anvio_tokens_input_total', base, input.inputTokens);
    this.incrementCounter('anvio_tokens_output_total', base, input.outputTokens);
    this.incrementCounter('anvio_tokens_total', base, input.totalTokens);
    if (input.estimatedCostUsd != null) {
      this.incrementCounter('anvio_token_cost_usd_total', base, input.estimatedCostUsd);
    }
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
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
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
