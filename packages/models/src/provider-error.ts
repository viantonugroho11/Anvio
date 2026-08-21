import { AnvioError } from '@anvio/core';
import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';

/**
 * Structured provider failure, attached to `AnvioError.details`.
 *
 * `retryable` is decided at the wrap site, where the typed SDK exception or the
 * raw HTTP status is still in hand. Downstream callers must read this flag rather
 * than re-deriving retryability from `AnvioError.statusCode`: that field defaults
 * to 502 for every `MODEL_PROVIDER_ERROR`, so a status-based rule would treat an
 * unclassified failure as a retryable upstream outage.
 */
export interface ProviderErrorDetails {
  provider: string;
  /** HTTP status reported by the provider; absent for transport-level failures. */
  status?: number;
  /** Provider error type (`rate_limit_error`), or a synthetic kind for non-HTTP failures. */
  type?: string;
  requestId?: string;
  retryable: boolean;
}

/** Statuses worth trying on another target; everything >= 500 is treated the same way. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function describe(provider: string, details: ProviderErrorDetails, detail?: string): string {
  const parts: string[] = [];
  if (details.status !== undefined) parts.push(`HTTP ${details.status}`);
  if (details.type) parts.push(details.type);
  if (details.requestId) parts.push(`request ${details.requestId}`);
  const context = parts.length > 0 ? ` (${parts.join(' ')})` : '';
  const tail = detail ? `: ${truncate(detail)}` : '';
  return `${provider} API call failed${context}${tail}`;
}

function truncate(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function build(
  provider: string,
  details: ProviderErrorDetails,
  detail?: string,
  cause?: Error,
): AnvioError {
  return new AnvioError('MODEL_PROVIDER_ERROR', describe(provider, details, detail), {
    statusCode: details.status,
    details,
    cause,
  });
}

/**
 * Wraps a non-2xx provider response. Callers must read the body as text *before*
 * calling this: an error response is frequently not JSON (a proxy's HTML error
 * page, a plain-text gateway message), and parsing it as JSON throws away the
 * status that decides retryability.
 */
export function httpProviderError(provider: string, status: number, body: string): AnvioError {
  const details: ProviderErrorDetails = {
    provider,
    status,
    type: providerErrorType(body),
    retryable: isRetryableStatus(status),
  };
  return build(provider, details, body);
}

/** Best-effort read of an `error.type` field from a JSON error body. */
function providerErrorType(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; code?: string } };
    return parsed.error?.type ?? parsed.error?.code;
  } catch {
    return undefined;
  }
}

/**
 * The provider accepted the request and refused to answer it — a safety block or
 * other policy stop. Never retryable: another target would refuse the same content,
 * and the HTTP call itself succeeded.
 */
export function providerRefusalError(
  provider: string,
  reason: string,
  detail?: string,
): AnvioError {
  return build(provider, { provider, type: `blocked:${reason}`, retryable: false }, detail);
}

/**
 * Re-raises a failure that a provider reported as a stream `error` chunk rather
 * than a throw. Streaming adapters yield instead of throwing, so the fallback
 * chain — which only sees exceptions — needs the chunk lifted back into one.
 */
export function providerStreamError(
  provider: string,
  message: string,
  retryable: boolean,
): AnvioError {
  return build(provider, { provider, type: 'stream_error', retryable }, message);
}

/**
 * Normalises anything thrown while calling a provider into an `AnvioError` carrying
 * `ProviderErrorDetails`. Already-normalised errors pass through unchanged so a
 * wrapping `catch` cannot bury the status a caller already established.
 */
export function toProviderError(provider: string, error: unknown): AnvioError {
  if (error instanceof AnvioError && readProviderErrorDetails(error)) return error;

  const cause = error instanceof Error ? error : undefined;

  // A user-initiated stop is not a provider fault and must never fail over.
  if (error instanceof APIUserAbortError || isAbortError(error)) {
    return build(provider, { provider, type: 'aborted', retryable: false }, undefined, cause);
  }

  if (error instanceof APIConnectionError) {
    return build(
      provider,
      { provider, type: 'connection_error', retryable: true },
      cause?.message,
      cause,
    );
  }

  if (error instanceof APIError) {
    const status = typeof error.status === 'number' ? error.status : undefined;
    return build(
      provider,
      {
        provider,
        status,
        type: error.type ?? undefined,
        requestId: error.requestID ?? undefined,
        retryable: isRetryableStatus(status),
      },
      undefined,
      cause,
    );
  }

  // Anything left is a transport-level failure (`fetch failed`, socket reset, DNS).
  // These are worth another target.
  return build(
    provider,
    { provider, type: 'connection_error', retryable: true },
    cause?.message,
    cause,
  );
}

/** A classified `error` stream chunk, for an adapter's catch block. */
export function toErrorChunk(
  provider: string,
  error: unknown,
): { type: 'error'; error: string; retryable: boolean } {
  const mapped = toProviderError(provider, error);
  return {
    type: 'error',
    error: mapped.message,
    retryable: readProviderErrorDetails(mapped)?.retryable ?? false,
  };
}

/** A classified `error` stream chunk for a non-2xx response. */
export function httpErrorChunk(
  provider: string,
  status: number,
  body: string,
): { type: 'error'; error: string; retryable: boolean } {
  return {
    type: 'error',
    error: httpProviderError(provider, status, body).message,
    retryable: isRetryableStatus(status),
  };
}

/** Walks the `cause` chain for provider details attached by `toProviderError`. */
export function readProviderErrorDetails(error: unknown): ProviderErrorDetails | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth += 1) {
    if (current instanceof AnvioError && isProviderErrorDetails(current.details)) {
      return current.details;
    }
    current = current.cause;
  }
  return undefined;
}

function isProviderErrorDetails(value: unknown): value is ProviderErrorDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProviderErrorDetails).provider === 'string' &&
    typeof (value as ProviderErrorDetails).retryable === 'boolean'
  );
}
