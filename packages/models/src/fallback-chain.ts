import type { RouteDefinition, RouteTarget } from '@anvio/core';

export interface RouteAttempt {
  target: RouteTarget;
  error?: string;
}

export interface FallbackResult<T> {
  result: T;
  target: RouteTarget;
  attempts: RouteAttempt[];
  failover: boolean;
}

export async function walkFallbackChain<T>(
  route: RouteDefinition,
  execute: (target: RouteTarget) => Promise<T>,
  isRetryable: (error: unknown) => boolean = defaultRetryable,
): Promise<FallbackResult<T>> {
  const attempts: RouteAttempt[] = [];
  const chain = [route.primary, ...route.fallback];

  for (let i = 0; i < chain.length; i += 1) {
    const target = chain[i]!;
    try {
      const result = await execute(target);
      return { result, target, attempts, failover: i > 0 };
    } catch (error) {
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
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|timeout|503|502/i.test(message);
}
