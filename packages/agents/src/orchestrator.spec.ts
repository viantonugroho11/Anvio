import { describe, expect, it } from 'vitest';
import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  Session,
  SessionStore,
  StoredSession,
} from '@anvio/core';
import {
  createOrchestrationPlan,
  isRetryableRunError,
  SupervisorOrchestrator,
} from './orchestrator.js';
import { AgentRunError } from './runtime.js';

function harness(
  run: (agentId: string, input: string) => Promise<AgentResult>,
  options: { maxConcurrency?: number; loadAgent?: (name: string) => Promise<AgentDefinition> } = {},
) {
  const created: StoredSession[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const sessions = {
    create: async (input: Partial<StoredSession>) => {
      const stored = { ...input, id: `sess-${created.length + 1}` } as StoredSession;
      created.push(stored);
      return stored;
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      updates.push({ id, patch });
      return undefined;
    },
  } as unknown as SessionStore;
  const runtime = {
    run: (_session: Session, agent: AgentDefinition, input: { content: string }) =>
      run((agent as unknown as { name: string }).name, input.content),
  } as unknown as AgentRuntime;
  const orchestrator = new SupervisorOrchestrator({
    runtime,
    sessions,
    loadAgent: options.loadAgent ?? (async (name) => ({ name }) as unknown as AgentDefinition),
    storedSessionToRuntime: (stored) => ({ id: stored.id }) as unknown as Session,
    maxConcurrency: options.maxConcurrency,
  });
  return { orchestrator, created, updates };
}

const manager = {} as AgentDefinition;
const managerSession = { id: 'mgr', userId: 'u', channel: 'cli' } as unknown as Session;
const ok = (content: string): AgentResult => ({
  sessionId: 's',
  content,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  status: 'completed',
});

describe('SupervisorOrchestrator', () => {
  it('reports a sub-agent waiting for approval instead of counting it as completed', async () => {
    const { orchestrator } = harness(async (agentId) =>
      agentId === 'writer' ? { ...ok('partial'), status: 'awaiting_approval' } : ok('done'),
    );
    const plan = createOrchestrationPlan('mgr', 'sequential', [
      { agentId: 'writer', input: 'write' },
      { agentId: 'reviewer', input: 'review', dependsOn: ['writer-0'] },
    ]);
    const result = await orchestrator.execute(plan, manager, managerSession);
    expect(result.results.map((r) => r.status)).toEqual(['awaiting_approval', 'skipped']);
    expect(result.status).toBe('partial');
  });

  it('does not retry non-retryable failures and marks the failed session', async () => {
    let attempts = 0;
    const { orchestrator, updates } = harness(async () => {
      attempts++;
      throw new AgentRunError('Session stopped by user', 'stopped', false);
    });
    const plan = createOrchestrationPlan('mgr', 'sequential', [
      { agentId: 'a', input: 'x', onFailure: 'retry', maxAttempts: 3 },
    ]);
    const result = await orchestrator.execute(plan, manager, managerSession);
    expect(attempts).toBe(1);
    expect(result.status).toBe('failed');
    expect(updates).toEqual([{ id: 'sess-1', patch: { status: 'failed' } }]);
  });

  it('retries retryable failures', async () => {
    let attempts = 0;
    const { orchestrator } = harness(async () => {
      attempts++;
      if (attempts < 2) throw new AgentRunError('HTTP 503', 'provider_error', true);
      return ok('second try');
    });
    const plan = createOrchestrationPlan('mgr', 'sequential', [
      { agentId: 'a', input: 'x', onFailure: 'retry', maxAttempts: 3 },
    ]);
    const result = await orchestrator.execute(plan, manager, managerSession);
    expect(attempts).toBe(2);
    expect(result.status).toBe('completed');
  });

  it('fails once without retry when the agent cannot be loaded', async () => {
    let runs = 0;
    const { orchestrator } = harness(
      async () => {
        runs++;
        return ok('x');
      },
      { loadAgent: async () => Promise.reject(new Error('Agent not found: ghost')) },
    );
    const plan = createOrchestrationPlan('mgr', 'sequential', [
      { agentId: 'ghost', input: 'x', onFailure: 'retry' },
    ]);
    const result = await orchestrator.execute(plan, manager, managerSession);
    expect(runs).toBe(0);
    expect(result.results[0]).toMatchObject({ status: 'failed', error: 'Agent not found: ghost' });
  });

  it('bounds parallel fan-out concurrency', async () => {
    let active = 0;
    let peak = 0;
    const { orchestrator } = harness(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return ok('x');
      },
      { maxConcurrency: 2 },
    );
    const tasks = Array.from({ length: 6 }, (_, i) => ({ agentId: `a${i}`, input: 'x' }));
    const result = await orchestrator.execute(
      createOrchestrationPlan('mgr', 'parallel', tasks),
      manager,
      managerSession,
    );
    expect(result.status).toBe('completed');
    expect(peak).toBe(2);
  });

  it('refuses plans nested deeper than the limit', async () => {
    const { orchestrator } = harness(async () => ok('x'));
    let plan = createOrchestrationPlan('mgr', 'sequential', [{ agentId: 'leaf', input: 'x' }]);
    for (let i = 0; i < 5; i++) {
      plan = createOrchestrationPlan('mgr', 'sequential', [
        { agentId: `n${i}`, input: '', subPlan: plan },
      ]);
    }
    const result = await orchestrator.execute(plan, manager, managerSession);
    expect(result.status).toBe('failed');
    expect(result.results.some((r) => r.error?.includes('deeper than'))).toBe(true);
  });
});

describe('isRetryableRunError', () => {
  it('honours explicit retryability and 4xx status codes', () => {
    expect(isRetryableRunError(new AgentRunError('x', 'provider_error', false))).toBe(false);
    expect(isRetryableRunError(new AgentRunError('x', 'stopped'))).toBe(false);
    expect(isRetryableRunError(Object.assign(new Error('bad'), { statusCode: 400 }))).toBe(false);
    expect(isRetryableRunError(new Error('socket hang up'))).toBe(true);
  });
});
