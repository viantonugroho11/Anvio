import { describe, expect, it } from 'vitest';
import type { RouteDefinition, RouteTarget } from '@anvio/core';
import { ProviderCircuitBreaker } from './circuit-breaker.js';
import { walkFallbackChain } from './fallback-chain.js';

describe('ProviderCircuitBreaker', () => {
  it('starts closed and permits calls', () => {
    const b = new ProviderCircuitBreaker();
    expect(b.canAttempt('anthropic')).toBe(true);
    expect(b.stateFor('anthropic')).toBe('closed');
  });

  it('opens after failureThreshold consecutive failures', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 3 });
    b.recordFailure('openai');
    b.recordFailure('openai');
    expect(b.canAttempt('openai')).toBe(true);
    b.recordFailure('openai');
    expect(b.stateFor('openai')).toBe('open');
    expect(b.canAttempt('openai')).toBe(false);
  });

  it('recordSuccess resets counter and closes circuit', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 2 });
    b.recordFailure('groq');
    b.recordSuccess('groq');
    b.recordFailure('groq'); // counter is 1, not 2
    expect(b.stateFor('groq')).toBe('closed');
    expect(b.canAttempt('groq')).toBe(true);
  });

  it('transitions open → half-open after cooldown', () => {
    let now = 1_000;
    const b = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 500,
      now: () => now,
    });
    b.recordFailure('x');
    expect(b.stateFor('x')).toBe('open');
    expect(b.canAttempt('x')).toBe(false);
    now = 1_500; // cooldown elapsed
    expect(b.canAttempt('x')).toBe(true);
    expect(b.stateFor('x')).toBe('half-open');
  });

  it('half-open failure re-opens the circuit and restarts the cooldown', () => {
    let now = 0;
    const b = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    b.recordFailure('y');
    now = 200;
    expect(b.canAttempt('y')).toBe(true); // half-open probe
    b.recordFailure('y'); // probe failed
    expect(b.stateFor('y')).toBe('open');
    expect(b.canAttempt('y')).toBe(false);
    now = 250; // 50ms since re-open, still open
    expect(b.canAttempt('y')).toBe(false);
    now = 301; // 101ms since re-open
    expect(b.canAttempt('y')).toBe(true);
  });
});

describe('walkFallbackChain with circuit breaker', () => {
  const route: RouteDefinition = {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    fallback: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'gemini', model: 'gemini-2.0-flash' },
    ],
  };

  it('skips targets whose circuit is open, records skip in attempts', async () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure('anthropic'); // opens anthropic
    const called: string[] = [];
    const result = await walkFallbackChain(
      route,
      async (target: RouteTarget) => {
        called.push(target.provider);
        return `${target.provider}-ok`;
      },
      { breaker },
    );
    expect(called).toEqual(['openai']);
    expect(result.attempts[0]?.skipped).toBe('circuit-open');
    expect(result.attempts[0]?.target.provider).toBe('anthropic');
    expect(result.target.provider).toBe('openai');
    expect(result.failover).toBe(true);
  });

  it('records success — closes circuit on the recovering provider', async () => {
    const breaker = new ProviderCircuitBreaker();
    await walkFallbackChain(route, async () => 'ok', { breaker });
    expect(breaker.stateFor('anthropic')).toBe('closed');
  });

  it('records failure on retryable errors so the next call skips them', async () => {
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 2 });
    let attempts = 0;
    // First call: primary fails twice (through the chain), opens breaker at 2nd fail
    for (let i = 0; i < 2; i++) {
      try {
        await walkFallbackChain(
          { primary: route.primary, fallback: [] },
          async () => {
            attempts++;
            throw new Error('rate limit exceeded');
          },
          { breaker },
        );
      } catch {
        // expected
      }
    }
    expect(attempts).toBe(2);
    expect(breaker.stateFor('anthropic')).toBe('open');
  });

  it('legacy positional isRetryable signature still supported', async () => {
    let called = 0;
    await expect(
      walkFallbackChain(
        { primary: route.primary, fallback: [] },
        async () => {
          called++;
          throw new Error('boom');
        },
        () => false, // non-retryable → immediate throw
      ),
    ).rejects.toThrow(/boom/);
    expect(called).toBe(1);
  });
});
