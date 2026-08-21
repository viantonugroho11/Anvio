import { describe, expect, it } from 'vitest';
import { AnvioError } from '@anvio/core';
import { APIError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk';
import { walkFallbackChain } from './fallback-chain.js';
import {
  httpProviderError,
  isRetryableStatus,
  readProviderErrorDetails,
  toProviderError,
} from './provider-error.js';

describe('isRetryableStatus', () => {
  it.each([408, 409, 425, 429, 500, 502, 503, 529])('treats %i as retryable', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats %i as terminal', (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });

  it('treats an unknown status as terminal', () => {
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe('httpProviderError', () => {
  it('carries status, type and retryability, and names the status in the message', () => {
    const error = httpProviderError(
      'openai',
      429,
      JSON.stringify({ error: { type: 'rate_limit_exceeded', message: 'slow down' } }),
    );

    expect(error).toBeInstanceOf(AnvioError);
    expect(error.code).toBe('MODEL_PROVIDER_ERROR');
    expect(error.statusCode).toBe(429);
    expect(error.message).toContain('HTTP 429');
    expect(error.message).toContain('rate_limit_exceeded');
    expect(readProviderErrorDetails(error)).toMatchObject({
      provider: 'openai',
      status: 429,
      type: 'rate_limit_exceeded',
      retryable: true,
    });
  });

  it('survives a non-JSON error body', () => {
    const error = httpProviderError('together', 502, '<html><body>Bad Gateway</body></html>');

    expect(error.statusCode).toBe(502);
    expect(readProviderErrorDetails(error)).toMatchObject({ status: 502, retryable: true });
  });

  it('marks a client error terminal', () => {
    const error = httpProviderError('gemini', 400, '{"error":{"code":"INVALID_ARGUMENT"}}');

    expect(readProviderErrorDetails(error)?.retryable).toBe(false);
  });
});

describe('toProviderError', () => {
  it('classifies an Anthropic APIError by its status and keeps the request id', () => {
    const headers = new Headers();
    const sdkError = new APIError(529, { type: 'overloaded_error' }, 'Overloaded', headers);
    const error = toProviderError('anthropic', sdkError);

    expect(readProviderErrorDetails(error)).toMatchObject({
      provider: 'anthropic',
      status: 529,
      retryable: true,
    });
    expect(error.message).toContain('HTTP 529');
  });

  it('treats a 400 from the SDK as terminal', () => {
    const sdkError = new APIError(400, { type: 'invalid_request_error' }, 'Bad', new Headers());

    expect(readProviderErrorDetails(toProviderError('anthropic', sdkError))?.retryable).toBe(false);
  });

  it('treats a connection failure as retryable', () => {
    const error = toProviderError(
      'anthropic',
      new APIConnectionError({ message: 'socket hang up' }),
    );

    expect(readProviderErrorDetails(error)).toMatchObject({
      type: 'connection_error',
      retryable: true,
    });
  });

  it('never retries a user abort', () => {
    const error = toProviderError('anthropic', new APIUserAbortError({}));

    expect(readProviderErrorDetails(error)).toMatchObject({ type: 'aborted', retryable: false });
  });

  it('never retries a fetch AbortError', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';

    expect(readProviderErrorDetails(toProviderError('gemini', abort))?.retryable).toBe(false);
  });

  it('treats an unclassified transport failure as retryable', () => {
    const error = toProviderError('groq', new TypeError('fetch failed'));

    expect(readProviderErrorDetails(error)).toMatchObject({
      type: 'connection_error',
      retryable: true,
    });
  });

  it('passes an already-classified error through unchanged', () => {
    const original = httpProviderError('openai', 404, '{}');

    expect(toProviderError('openai', original)).toBe(original);
  });
});

describe('walkFallbackChain retry classification', () => {
  const route = {
    primary: { provider: 'anthropic', model: 'a' },
    fallback: [{ provider: 'openai', model: 'b' }],
  } as Parameters<typeof walkFallbackChain>[0];

  it('fails over on a retryable provider error', async () => {
    const seen: string[] = [];
    const result = await walkFallbackChain(route, async (target) => {
      seen.push(target.provider);
      if (target.provider === 'anthropic') throw httpProviderError('anthropic', 529, '{}');
      return 'recovered';
    });

    expect(seen).toEqual(['anthropic', 'openai']);
    expect(result.result).toBe('recovered');
    expect(result.failover).toBe(true);
  });

  it('does not fail over on a terminal provider error', async () => {
    const seen: string[] = [];

    await expect(
      walkFallbackChain(route, async (target) => {
        seen.push(target.provider);
        throw httpProviderError(target.provider, 401, '{}');
      }),
    ).rejects.toThrow(/HTTP 401/);

    expect(seen).toEqual(['anthropic']);
  });

  it('does not treat the default 502 of an unclassified AnvioError as retryable', () => {
    // AnvioError defaults MODEL_PROVIDER_ERROR to statusCode 502. A status-based
    // rule would call this retryable; classification must come from the wrap site.
    const bare = new AnvioError('MODEL_PROVIDER_ERROR', 'something went wrong');

    expect(bare.statusCode).toBe(502);
    expect(readProviderErrorDetails(bare)).toBeUndefined();
  });

  it('finds details through a wrapping cause chain', () => {
    const inner = httpProviderError('deepseek', 503, '{}');
    const outer = new AnvioError('AGENT_RUNTIME_ERROR', 'agent turn failed', { cause: inner });

    expect(readProviderErrorDetails(outer)).toMatchObject({
      provider: 'deepseek',
      retryable: true,
    });
  });
});
