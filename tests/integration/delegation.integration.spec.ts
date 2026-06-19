import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SupervisorOrchestrator,
  createOrchestrationPlan,
  resolveTaskOrder,
} from '@anvio/agents';
import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  Session,
  SessionStore,
  StoredSession,
} from '@anvio/core';
import { LocalEventBus, EventSubjects } from '@anvio/events';

function mockAgent(name: string): AgentDefinition {
  return {
    apiVersion: 'anvio.io/v1',
    kind: 'Agent',
    metadata: { name, version: '1.0.0' },
    spec: {
      description: name,
      persona: 'default',
      skills: [],
      tools: [],
      model: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    },
  };
}

function createMockRuntime(responses: Record<string, string> = {}): AgentRuntime {
  return {
    async run(_session, agent, input) {
      const content = responses[agent.metadata.name] ?? `Result for: ${input.content}`;
      return {
        content,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        status: 'completed',
      } satisfies AgentResult;
    },
  };
}

function createMockSessions(): SessionStore {
  let counter = 0;
  const sessions = new Map<string, StoredSession>();
  return {
    async create(input) {
      counter += 1;
      const stored: StoredSession = {
        id: `sess-${counter}`,
        userId: input.userId,
        agentName: input.agentName,
        channel: input.channel,
        messages: [],
        status: 'idle',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        parentSessionId: input.parentSessionId,
        detached: input.detached,
      };
      sessions.set(stored.id, stored);
      return stored;
    },
    async get(id) {
      return sessions.get(id) ?? null;
    },
    async getByChannelThread() {
      return null;
    },
    async list() {
      return [...sessions.values()];
    },
    async listActive() {
      return [...sessions.values()];
    },
    async update(id, patch) {
      const existing = sessions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      sessions.set(id, updated);
      return updated;
    },
  };
}

describe('Subagent Delegation v2', () => {
  let managerSession: Session;

  beforeEach(() => {
    managerSession = {
      id: 'mgr-1',
      userId: 'user-1',
      agentId: 'manager',
      channel: 'cli',
      state: { status: 'idle', messages: [] },
      lastActiveAt: new Date(),
    };
  });

  it('runs sequential pipeline with dependencies in order', async () => {
    const order: string[] = [];
    const runtime: AgentRuntime = {
      async run(_session, agent, input) {
        order.push(agent.metadata.name);
        return {
          content: `${agent.metadata.name}-out`,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          status: 'completed',
        };
      },
    };

    const orchestrator = new SupervisorOrchestrator({
      runtime,
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
    });

    const plan = createOrchestrationPlan('manager', 'sequential', [
      { id: 'research-1', agentId: 'researcher', input: 'Research' },
      { id: 'design-1', agentId: 'architect', input: 'Design', dependsOn: ['research-1'] },
    ]);

    const result = await orchestrator.execute(plan, mockAgent('manager'), managerSession);
    expect(result.status).toBe('completed');
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.status === 'completed')).toBe(true);
    expect(order).toEqual(['researcher', 'architect']);
  });

  it('parallel fan-out completes all tasks', async () => {
    const orchestrator = new SupervisorOrchestrator({
      runtime: createMockRuntime(),
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
    });

    const plan = createOrchestrationPlan('manager', 'parallel', [
      { agentId: 'researcher', input: 'A' },
      { agentId: 'architect', input: 'B' },
    ]);

    const result = await orchestrator.execute(plan, mockAgent('manager'), managerSession);
    expect(result.status).toBe('completed');
    expect(result.results.filter((r) => r.status === 'completed')).toHaveLength(2);
  });

  it('onFailure abort stops after first failure', async () => {
    const runtime: AgentRuntime = {
      async run(_session, agent) {
        if (agent.metadata.name === 'researcher') {
          throw new Error('research failed');
        }
        return {
          content: 'ok',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          status: 'completed',
        };
      },
    };

    const orchestrator = new SupervisorOrchestrator({
      runtime,
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
    });

    const plan = createOrchestrationPlan('manager', 'sequential', [
      { id: 't1', agentId: 'researcher', input: 'fail', onFailure: 'abort' },
      { id: 't2', agentId: 'architect', input: 'never runs' },
    ]);

    const result = await orchestrator.execute(plan, mockAgent('manager'), managerSession);
    expect(result.status).toBe('failed');
    expect(result.results.find((r) => r.taskId === 't1')?.status).toBe('failed');
    expect(result.results.find((r) => r.taskId === 't2')?.status).toBe('skipped');
  });

  it('onFailure continue skips dependents of failed task', async () => {
    const runtime: AgentRuntime = {
      async run(_session, agent) {
        if (agent.metadata.name === 'researcher') {
          throw new Error('research failed');
        }
        return {
          content: 'ok',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          status: 'completed',
        };
      },
    };

    const orchestrator = new SupervisorOrchestrator({
      runtime,
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
    });

    const plan = createOrchestrationPlan('manager', 'sequential', [
      { id: 't1', agentId: 'researcher', input: 'fail', onFailure: 'continue' },
      { id: 't2', agentId: 'architect', input: 'depends on t1', dependsOn: ['t1'] },
      { id: 't3', agentId: 'qa-agent', input: 'independent' },
    ]);

    const result = await orchestrator.execute(plan, mockAgent('manager'), managerSession);
    expect(result.results.find((r) => r.taskId === 't2')?.status).toBe('skipped');
    expect(result.results.find((r) => r.taskId === 't3')?.status).toBe('completed');
  });

  it('fan-in synthesizes manager result', async () => {
    const orchestrator = new SupervisorOrchestrator({
      runtime: createMockRuntime({ manager: 'Synthesized summary' }),
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
    });

    const plan = createOrchestrationPlan('manager', 'fan-in', [
      { agentId: 'researcher', input: 'A' },
      { agentId: 'architect', input: 'B' },
    ]);

    const result = await orchestrator.execute(plan, mockAgent('manager'), managerSession);
    expect(result.synthesized).toBe('Synthesized summary');
    expect(result.results.some((r) => r.agentId === 'manager')).toBe(true);
  });

  it('publishes delegation events', async () => {
    const bus = new LocalEventBus('/test');
    const publish = vi.spyOn(bus, 'publishCore');

    const orchestrator = new SupervisorOrchestrator({
      runtime: createMockRuntime(),
      sessions: createMockSessions(),
      loadAgent: async (name) => mockAgent(name),
      storedSessionToRuntime: (s) => ({
        id: s.id,
        userId: s.userId,
        agentId: s.agentName,
        channel: s.channel,
        state: { status: s.status, messages: s.messages },
        lastActiveAt: new Date(s.lastActiveAt),
      }),
      publishEvent: (subject, type, data) => bus.publishCore(subject, type, data),
    });

    const plan = createOrchestrationPlan('manager', 'sequential', [
      { id: 't1', agentId: 'researcher', input: 'Go' },
    ]);

    await orchestrator.execute(plan, mockAgent('manager'), managerSession);

    expect(publish).toHaveBeenCalledWith(
      EventSubjects.DELEGATION_TASK_STARTED,
      'anvio.delegation.task.started',
      expect.objectContaining({ taskId: 't1' }),
    );
    expect(publish).toHaveBeenCalledWith(
      EventSubjects.DELEGATION_TASK_COMPLETED,
      'anvio.delegation.task.completed',
      expect.objectContaining({ taskId: 't1' }),
    );
  });

  it('resolveTaskOrder respects dependsOn', () => {
    const tasks = resolveTaskOrder([
      { id: 'b', agentId: 'b', input: '', dependsOn: ['a'] },
      { id: 'a', agentId: 'a', input: '' },
    ]);
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
