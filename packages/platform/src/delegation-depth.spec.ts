import { afterEach, describe, expect, it } from 'vitest';
import {
  currentDelegationDepth,
  DEFAULT_MAX_DELEGATION_DEPTH,
  DelegationDepthError,
  resolveMaxDelegationDepth,
  withDelegationDepth,
} from './delegation-depth.js';

afterEach(() => {
  delete process.env.ANVIO_MAX_DELEGATION_DEPTH;
});

/** An agent that always delegates again — the recursion PR-01 reproduced. */
async function delegateForever(levels: number[]): Promise<never> {
  return withDelegationDepth(async () => {
    levels.push(currentDelegationDepth());
    return delegateForever(levels);
  });
}

describe('withDelegationDepth', () => {
  it('stops a self-delegating chain at the default limit', async () => {
    const levels: number[] = [];
    await expect(delegateForever(levels)).rejects.toBeInstanceOf(DelegationDepthError);
    expect(levels).toEqual([1, 2, 3]);
    expect(DEFAULT_MAX_DELEGATION_DEPTH).toBe(3);
  });

  it('tracks depth per call chain, so parallel siblings do not share a counter', async () => {
    const seen = await Promise.all(
      Array.from({ length: 5 }, () => withDelegationDepth(async () => currentDelegationDepth())),
    );
    expect(seen).toEqual([1, 1, 1, 1, 1]);
    expect(currentDelegationDepth()).toBe(0);
  });

  it('honours ANVIO_MAX_DELEGATION_DEPTH, including 0 to disable delegation', async () => {
    process.env.ANVIO_MAX_DELEGATION_DEPTH = '0';
    expect(resolveMaxDelegationDepth()).toBe(0);
    await expect(withDelegationDepth(async () => 'ran')).rejects.toBeInstanceOf(
      DelegationDepthError,
    );
    process.env.ANVIO_MAX_DELEGATION_DEPTH = 'not-a-number';
    expect(resolveMaxDelegationDepth()).toBe(DEFAULT_MAX_DELEGATION_DEPTH);
  });
});
