export const dynamic = 'force-dynamic';

import { apiFetch, type Agent } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Bot } from 'lucide-react';

export default async function AgentsPage() {
  let agents: Agent[] = [];
  try {
    agents = await apiFetch<Agent[]>('/agents');
  } catch {
    // fallback
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Agents</h1>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-[var(--text-muted)]">
          No agents configured. Add agent definitions to your workspace.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.name} className="transition-colors hover:border-[var(--accent)]/40">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15">
                  <Bot size={20} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold">{a.name}</h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)] line-clamp-2">
                    {a.description ?? 'No description'}
                  </p>
                  {a.spec?.model ? (
                    <p className="mt-2 font-mono text-xs text-[var(--text-muted)]">
                      {String(a.spec.model)}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
