'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';

interface MetricLine {
  name: string;
  labels: string;
  value: string;
}

function parsePrometheus(text: string): MetricLine[] {
  return text
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const match = l.match(/^([a-zA-Z_]+)(\{[^}]*\})?\s+(.+)$/);
      if (!match) return null;
      return { name: match[1], labels: match[2] ?? '', value: match[3] };
    })
    .filter(Boolean) as MetricLine[];
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricLine[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/metrics');
        if (!res.ok) throw new Error();
        const text = await res.text();
        setMetrics(parsePrometheus(text));
        setError(false);
      } catch {
        setError(true);
      }
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Metrics</h1>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-[var(--text-muted)]">
          Cannot reach metrics endpoint. Start the API server.
        </div>
      </div>
    );
  }

  const grouped = metrics.reduce<Record<string, MetricLine[]>>((acc, m) => {
    (acc[m.name] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Metrics</h1>
        <span className="text-xs text-[var(--text-muted)]">Auto-refreshes every 10s</span>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-[var(--text-muted)]">
          No metrics recorded yet. Run some sessions to generate data.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(grouped).map(([name, lines]) => (
            <Card key={name}>
              <CardTitle>{name}</CardTitle>
              <div className="mt-3 space-y-1">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-[var(--text-muted)] truncate max-w-[70%]">
                      {l.labels || '(no labels)'}
                    </span>
                    <span className="font-mono font-semibold">{l.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
