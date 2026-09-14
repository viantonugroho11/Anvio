export interface FetchRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (response: Response) => boolean;
  /**
   * Upper bound for a wait the server itself asked for. The exponential
   * schedule is capped by `maxDelayMs`, which is deliberately short; a
   * `Retry-After` of 30s is a real instruction, not a transient blip, so it
   * gets its own ceiling (issue #75).
   */
  maxRetryAfterMs?: number;
}

const DEFAULT_RETRY_ON = (response: Response) => response.status === 429 || response.status >= 500;

/**
 * Wait the server asked for, in ms, or null when it did not say.
 *
 * Every chat platform states its own backoff and the helper used to discard
 * all of it: Telegram puts `parameters.retry_after` in the JSON body, Discord
 * uses a body `retry_after` plus `X-RateLimit-Reset-After`, Slack and
 * Mattermost use the standard `Retry-After` header. With the old fixed
 * schedule capped at 5s, a Telegram `retry_after: 30` was guaranteed to
 * exhaust its retries and throw.
 */
async function retryAfterMs(response: Response): Promise<number | null> {
  const header =
    response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    // RFC 7231 also allows an HTTP-date.
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }

  // Body forms. Read from a clone so the caller still gets an unconsumed body.
  try {
    const body = (await response.clone().json()) as {
      retry_after?: unknown;
      parameters?: { retry_after?: unknown };
    };
    const value = body?.parameters?.retry_after ?? body?.retry_after;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Telegram reports seconds; Discord has used both seconds and ms.
      return Math.max(0, value < 1000 ? value * 1000 : value);
    }
  } catch {
    // Not JSON, or already consumed — fall back to the exponential schedule.
  }

  return null;
}

/** Fetch with exponential backoff for rate limits and transient errors. */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
  const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!retryOn(response) || attempt === retries) {
        return response;
      }
      const asked = await retryAfterMs(response);
      await sleep(
        asked === null
          ? Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
          : Math.min(asked, maxRetryAfterMs),
      );
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
    }
  }
  throw lastError ?? new Error('fetchWithRetry failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
