import type { RouteDefinition, RouteTarget } from '@anvio/core';
import type { ProviderCircuitBreaker } from './circuit-breaker.js';
import { readProviderErrorDetails } from './provider-error.js';

export interface RouteAttempt {
  target: RouteTarget;
  error?: string;
  skipped?: 'circuit-open';
}

export interface FallbackResult<T> {
  result: T;
  target: RouteTarget;
  attempts: RouteAttempt[];
  failover: boolean;
}

export interface WalkFallbackOptions {
  isRetryable?: (error: unknown) => boolean;
  /** Optional per-provider circuit breaker — skips targets whose circuit is open. */
  breaker?: ProviderCircuitBreaker;
}

export async function walkFallbackChain<T>(
  route: RouteDefinition,
  execute: (target: RouteTarget) => Promise<T>,
  optionsOrLegacy?: WalkFallbackOptions | ((error: unknown) => boolean),
): Promise<FallbackResult<T>> {
  // Backward-compat: prior signature accepted `isRetryable` as the third positional arg.
  const options: WalkFallbackOptions =
    typeof optionsOrLegacy === 'function'
      ? { isRetryable: optionsOrLegacy }
      : optionsOrLegacy ?? {};
  const isRetryable = options.isRetryable ?? defaultRetryable;
  const breaker = options.breaker;

  const attempts: RouteAttempt[] = [];
  const chain = [route.primary, ...route.fallback];

  for (let i = 0; i < chain.length; i += 1) {
    const target = chain[i]!;

    if (breaker && !breaker.canAttempt(target.provider)) {
      attempts.push({ target, skipped: 'circuit-open' });
      if (i === chain.length - 1) {
        throw new Error(`Fallback chain exhausted — every target's circuit is open`);
      }
      continue;
    }

    try {
      const result = await execute(target);
      breaker?.recordSuccess(target.provider);
      return { result, target, attempts, failover: i > 0 };
    } catch (error) {
      if (isRetryable(error)) {
        breaker?.recordFailure(target.provider);
      }
      attempts.push({
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!isRetryable(error) || i === chain.length - 1) {
        throw error;
      }
    }
  }

  throw new Error('Fallback chain exhausted');
}

function defaultRetryable(error: unknown): boolean {
  // Providers classify their own failures at the point where the typed SDK
  // exception or HTTP status is still available.
  const details = readProviderErrorDetails(error);
  if (details) return details.retryable;

  // Anything not raised by a provider (route resolution, budget guards, plain
  // Errors from callers) keeps the original message-matching behaviour.
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|timeout|503|502/i.test(message);
}
