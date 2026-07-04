export const dynamic = 'force-dynamic';

import { apiFetch, type Overview } from '@/lib/api';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Activity, MessageSquare, Bot, Wrench } from 'lucide-react';

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function OverviewPage() {
  let data: Overview | null = null;
  try {
    data = await apiFetch<Overview>('/overview');
  } catch {
    // API not reachable
  }

  if (!data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center">
          <p className="text-[var(--text-muted)]">
            Cannot reach Anvio API. Start it with{' '}
            <code className="rounded bg-[var(--bg-hover)] px-2 py-0.5 text-sm">
              pnpm --filter @anvio/api dev
            </code>
          </p>
        </div>
      </div>
    );
  }

  const cards = [
    {
      title: 'Total Sessions',
      value: data.sessions.total,
      sub: `${data.sessions.active} active`,
      icon: MessageSquare,
      color: 'var(--blue)',
    },
    {
      title: 'Agents',
      value: data.agents.total,
      sub: 'configured',
      icon: Bot,
      color: 'var(--accent)',
    },
    {
      title: 'Gateway Tools',
      value: `${data.tools.enabled}/${data.tools.total}`,
      sub: 'enabled',
      icon: Wrench,
      color: 'var(--green)',
    },
    {
      title: 'Uptime',
      value: formatUptime(data.health.uptime),
      sub: data.health.status,
      icon: Activity,
      color: 'var(--yellow)',
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{c.title}</CardTitle>
                <CardValue className="mt-2">{c.value}</CardValue>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{c.sub}</p>
              </div>
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: `color-mix(in srgb, ${c.color} 15%, transparent)` }}
              >
                <c.icon size={20} style={{ color: c.color }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
