export const dynamic = 'force-dynamic';

import { apiFetch, type CredentialPoolView } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { AddKeyForm, TestPoolButton } from './add-key-form';

export default async function ProvidersPage() {
  let pools: CredentialPoolView[] = [];
  let error: string | null = null;

  try {
    pools = await apiFetch<CredentialPoolView[]>('/credentials/pools');
  } catch (err) {
    // Most likely cause is a disabled feature rather than a fault: the API
    // answers 503 with the passphrase instruction when pools are off.
    error = err instanceof Error ? err.message : 'Could not reach the API.';
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Provider keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          Keys pasted here are encrypted at rest and used by routes that name a pool. Most vendors
          have no way to hand a key to another application, so there is nothing to sign in to — copy
          the key from the provider’s own dashboard.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">
          {error}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-4 text-sm font-medium">Add a key</h2>
        <AddKeyForm pools={pools.map((pool) => pool.slug)} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-muted)]">
          Pools ({pools.length})
        </h2>

        {pools.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center text-sm text-[var(--text-muted)]">
            No pools yet. Add a key above, or run{' '}
            <code className="font-mono text-xs">anvio credentials add</code>.
          </div>
        ) : (
          <div className="space-y-3">
            {pools.map((pool) => (
              <div
                key={pool.slug}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{pool.slug}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {pool.provider} · {pool.strategy} · {pool.credentials.length} credential
                      {pool.credentials.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <TestPoolButton pool={pool.slug} />
                </div>

                {pool.credentials.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pool.credentials.map((credential) => (
                      <Badge
                        key={credential.id}
                        variant={credential.status === 'active' ? 'success' : 'default'}
                      >
                        {credential.id}
                        {credential.status !== 'active' ? ` · ${credential.status}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
