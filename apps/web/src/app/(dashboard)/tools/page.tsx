export const dynamic = 'force-dynamic';

import { apiFetch, type ToolEntry } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

export default async function ToolsPage() {
  let tools: ToolEntry[] = [];
  try {
    tools = await apiFetch<ToolEntry[]>('/tools');
  } catch {
    // fallback
  }

  const enabled = tools.filter((t) => t.enabled);
  const disabled = tools.filter((t) => !t.enabled);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Gateway Tools</h1>
        <div className="text-sm text-[var(--text-muted)]">
          {enabled.length} enabled / {tools.length} total
        </div>
      </div>

      {tools.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-[var(--text-muted)]">
          No tools found. Make sure the API is running.
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--green)]">
              Enabled ({enabled.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {enabled.map((t) => (
                <Badge key={t.name} variant="success">
                  {t.name}
                </Badge>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--text-muted)]">
              Disabled ({disabled.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {disabled.map((t) => (
                <Badge key={t.name} variant="muted">
                  {t.name}
                </Badge>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
