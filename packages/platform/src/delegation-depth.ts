import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Nesting depth of agent runs started by other agents (`delegate_task`,
 * `mixture_of_agents`). A delegated agent may call `delegate_task` itself; with no
 * limit, an agent that delegates to an agent that delegates again recursed without
 * bound — 3 000+ nested sessions in three seconds in the post-refactoring E2E run.
 * AsyncLocalStorage carries the depth through the nested `runtime.run` calls,
 * whatever tool path started them.
 */
const delegationDepth = new AsyncLocalStorage<number>();

export const DEFAULT_MAX_DELEGATION_DEPTH = 3;

/** Upper bound on agents a single `mixture_of_agents` call may fan out to. */
export const MAX_MIXTURE_AGENTS = 8;

export function resolveMaxDelegationDepth(): number {
  const parsed = Number.parseInt(process.env.ANVIO_MAX_DELEGATION_DEPTH ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_DELEGATION_DEPTH;
}

export class DelegationDepthError extends Error {
  constructor(readonly maxDepth: number) {
    super(
      `Delegation depth limit reached (${maxDepth}): a delegated agent may not delegate further. ` +
        'Answer with what you have, or raise ANVIO_MAX_DELEGATION_DEPTH.',
    );
    this.name = 'DelegationDepthError';
  }
}

/** Run `task` one delegation level deeper, refusing past the limit. */
export function withDelegationDepth<T>(
  task: () => Promise<T>,
  maxDepth = resolveMaxDelegationDepth(),
): Promise<T> {
  const depth = delegationDepth.getStore() ?? 0;
  if (depth >= maxDepth) return Promise.reject(new DelegationDepthError(maxDepth));
  return delegationDepth.run(depth + 1, task);
}

export function currentDelegationDepth(): number {
  return delegationDepth.getStore() ?? 0;
}
