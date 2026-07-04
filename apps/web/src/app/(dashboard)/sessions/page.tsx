export const dynamic = 'force-dynamic';

import { apiFetch, type Session } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

function statusVariant(status: string) {
  if (status === 'running') return 'success';
  if (status === 'idle') return 'warning';
  if (status === 'error') return 'danger';
  return 'muted';
}

export default async function SessionsPage() {
  let sessions: Session[] = [];
  try {
    sessions = await apiFetch<Session[]>('/sessions');
  } catch {
    // fallback
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Sessions</h1>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-[var(--text-muted)]">
          No sessions found. Create one via the CLI or API.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-card)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">ID</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Agent</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Channel</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Status</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Messages</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[var(--border)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <td className="px-4 py-3 font-mono text-xs">{s.id.slice(0, 12)}</td>
                  <td className="px-4 py-3">{s.agentName}</td>
                  <td className="px-4 py-3">
                    <Badge variant="default">{s.channel}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {s.messages?.length ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
