import {
  DEFAULT_EGRESS_POLICY,
  guardedFetch,
  readBodyCapped,
  withTimeout,
  type EgressPolicy,
} from './egress.js';

export interface HttpRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Caller cancellation, combined with the timeout. */
  signal?: AbortSignal;
}

/** Model-supplied timeouts are clamped so one call cannot hold a turn open indefinitely. */
const MAX_HTTP_TIMEOUT_MS = 60_000;
/** Characters of body returned to the model (the byte cap bounds memory; this bounds context). */
const MAX_HTTP_BODY_CHARS = 32_000;

export async function httpRequest(
  input: HttpRequestInput,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
): Promise<{
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const method = (input.method ?? 'GET').toUpperCase();
  const timeoutMs = Math.min(input.timeoutMs ?? 15_000, MAX_HTTP_TIMEOUT_MS);
  const { response: res } = await guardedFetch(
    input.url,
    {
      method,
      headers: input.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
      signal: withTimeout(timeoutMs, input.signal),
    },
    policy,
  );
  const { text: body } = await readBodyCapped(res, policy.maxResponseBytes);
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    url: input.url,
    status: res.status,
    headers,
    body: body.slice(0, MAX_HTTP_BODY_CHARS),
  };
}
