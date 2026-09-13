import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './fetch-retry.js';

function response(status: number, init: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** Run `fn` with fake timers, auto-advancing so sleeps resolve immediately. */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<{ result: T; waits: number[] }> {
  const waits: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal('setTimeout', ((cb: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return realSetTimeout(cb, 0);
  }) as typeof setTimeout);
  try {
    return { result: await fn(), waits };
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithRetry Retry-After handling (issue #75)', () => {
  it('honours a Retry-After header in seconds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, { headers: { 'retry-after': '30' } }))
      .mockResolvedValueOnce(response(200, { body: { ok: true } }));

    const { waits } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, { retries: 2 });
    });

    // 30s, not the 200ms the exponential schedule would have picked.
    expect(waits[0]).toBe(30_000);
  });

  it('honours Telegram-style parameters.retry_after in the body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(429, { body: { ok: false, parameters: { retry_after: 12 } } }),
      )
      .mockResolvedValueOnce(response(200, { body: { ok: true } }));

    const { waits } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, { retries: 2 });
    });

    expect(waits[0]).toBe(12_000);
  });

  it('leaves the response body readable for the caller', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, { body: { parameters: { retry_after: 1 } } }))
      .mockResolvedValueOnce(response(200, { body: { ok: true, value: 42 } }));

    const { result } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, { retries: 2 });
    });

    await expect(result.json()).resolves.toEqual({ ok: true, value: 42 });
  });

  it('caps a hostile Retry-After at maxRetryAfterMs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, { headers: { 'retry-after': '86400' } }))
      .mockResolvedValueOnce(response(200, { body: { ok: true } }));

    const { waits } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, {
        retries: 2,
        maxRetryAfterMs: 5_000,
      });
    });

    expect(waits[0]).toBe(5_000);
  });

  it('falls back to the exponential schedule when the server says nothing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, { body: { ok: true } }));

    const { waits } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, { retries: 3, baseDelayMs: 100 });
    });

    expect(waits.slice(0, 2)).toEqual([100, 200]);
  });

  it('returns the last response instead of throwing once retries run out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(429, { headers: { 'retry-after': '1' } }));

    const { result } = await withFakeTimers(async () => {
      vi.stubGlobal('fetch', fetchMock);
      return fetchWithRetry('https://example.test', undefined, { retries: 1 });
    });

    expect(result.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
