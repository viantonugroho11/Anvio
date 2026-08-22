'use client';

import { useActionState } from 'react';
import { addCredential, testPool, type ActionResult } from './actions';

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={result.ok ? 'mt-3 text-sm text-[var(--green)]' : 'mt-3 text-sm text-[var(--red)]'}
    >
      {result.message}
    </p>
  );
}

export function AddKeyForm({ pools }: { pools: string[] }) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    addCredential,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-[var(--text-muted)]">Provider pool</span>
          <input
            name="pool"
            required
            list="known-pools"
            placeholder="anthropic"
            autoComplete="off"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
          <datalist id="known-pools">
            {pools.map((pool) => (
              <option key={pool} value={pool} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-[var(--text-muted)]">Credential name</span>
          <input
            name="id"
            required
            placeholder="primary"
            autoComplete="off"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm text-[var(--text-muted)]">API key</span>
        <input
          name="value"
          type="password"
          required
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
        />
        <span className="mt-1.5 block text-xs text-[var(--text-muted)]">
          Encrypted at rest and never shown again — not even a prefix. To replace it, save a new
          credential name and disable the old one.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save key'}
      </button>

      <Result result={result} />
    </form>
  );
}

export function TestPoolButton({ pool }: { pool: string }) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(testPool, null);

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="pool" value={pool} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
      >
        {pending ? 'Testing…' : 'Test'}
      </button>
      {result && (
        <span className={result.ok ? 'text-xs text-[var(--green)]' : 'text-xs text-[var(--red)]'}>
          {result.message}
        </span>
      )}
    </form>
  );
}
