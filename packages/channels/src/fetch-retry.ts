export interface FetchRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (response: Response) => boolean;
}

const DEFAULT_RETRY_ON = (response: Response) =>
  response.status === 429 || response.status >= 500;

/** Fetch with exponential backoff for rate limits and transient errors. */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!retryOn(response) || attempt === retries) {
        return response;
      }
      await sleep(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
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
