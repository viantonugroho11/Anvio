/**
 * Absolute by default. These calls run server-side — in server components and
 * server actions — and Node's fetch rejects a relative URL, so an unset
 * `NEXT_PUBLIC_API_URL` used to make every request throw before it was sent.
 * The default matches the API's own loopback default (ADR-0018).
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3000';

/**
 * Server-only. `ANVIO_API_TOKEN` is deliberately not `NEXT_PUBLIC_`, so it is
 * readable here and absent from the browser bundle — which is why every call
 * that needs it goes through a server component or a server action rather than
 * being fetched from the client.
 *
 * Empty when auth is disabled, which is the Level-1 default (ADR-0018).
 */
function authHeaders(): Record<string, string> {
  const token = process.env.ANVIO_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fail(res: Response, path: string): Promise<never> {
  // Surface the API's own message: it carries the actionable part, e.g. that
  // credential pools need a passphrase.
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ? ` — ${body.message}` : '';
  } catch {
    // non-JSON error body; the status alone will have to do
  }
  throw new Error(`API ${res.status}: ${path}${detail}`);
}

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    next: { revalidate: 5 },
    headers: authHeaders(),
  });
  if (!res.ok) await fail(res, path);
  return res.json() as Promise<T>;
}

/** Mutating counterpart to `apiFetch`. Never cached. */
export async function apiSend<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await fail(res, path);
  return res.json() as Promise<T>;
}

export interface Overview {
  sessions: { total: number; active: number };
  agents: { total: number };
  tools: { total: number; enabled: number };
  health: { status: string; uptime: number };
}

export interface Session {
  id: string;
  agentName: string;
  channel: string;
  status: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: Array<{ role: string; content: string; timestamp?: string }>;
}

export interface Agent {
  name: string;
  description?: string;
  spec: Record<string, unknown>;
}

export interface ToolEntry {
  name: string;
  enabled: boolean;
}

export interface CredentialPoolView {
  slug: string;
  provider: string;
  strategy: string;
  credentials: Array<{ id: string; status: string; rateLimitedUntil?: string }>;
}
