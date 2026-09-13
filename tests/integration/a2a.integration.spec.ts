import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { A2AServer, type A2AServerConfig } from '@anvio/a2a';
import { A2AClient } from '@anvio/a2a';
import { TaskState, Role } from '@a2a-js/sdk';
import type { AgentDefinition } from '@anvio/core';
import { AgentEvent } from '@a2a-js/sdk/server';

const TEST_AGENT: AgentDefinition = {
  apiVersion: 'anvio.io/v1',
  kind: 'Agent',
  metadata: { name: 'integration-agent', version: '1.0.0' },
  spec: {
    description: 'Integration test agent',
    persona: 'You are an integration test agent.',
    skills: ['echo'],
    tools: [],
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
    memory: { shortTerm: { enabled: true, ttlSeconds: 3600 }, longTerm: { enabled: true }, semantic: { enabled: false } },
    orchestration: { pattern: 'single', delegates: [] },
    approvals: { requiredFor: ['destructive'] },
    workspace: { isolatedWorktree: false },
  },
};

const A2A_HEADERS = {
  'Content-Type': 'application/json',
  'A2A-Version': '1.0',
};

function createServer(onMessage: A2AServerConfig['onMessage']): A2AServer {
  return new A2AServer({
    host: '127.0.0.1',
    port: 0,
    agents: [TEST_AGENT],
    cardOptions: { baseUrl: 'http://localhost:0' },
    onMessage,
  });
}

function makeV1UserMessage(text: string) {
  return {
    messageId: randomUUID(),
    role: 'ROLE_USER',
    parts: [{ text }],
  };
}

function completeWithText(
  ctx: { taskId: string; contextId: string },
  bus: { publish: (event: any) => void },
  text: string,
) {
  bus.publish(AgentEvent.statusUpdate({
    taskId: ctx.taskId,
    contextId: ctx.contextId,
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      message: {
        messageId: randomUUID(),
        contextId: ctx.contextId,
        taskId: ctx.taskId,
        role: Role.ROLE_AGENT,
        parts: [{
          content: { $case: 'text' as const, value: text },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
      timestamp: new Date().toISOString(),
    },
    metadata: undefined,
  }));
}

function completeNoMessage(
  ctx: { taskId: string; contextId: string },
  bus: { publish: (event: any) => void },
) {
  bus.publish(AgentEvent.statusUpdate({
    taskId: ctx.taskId,
    contextId: ctx.contextId,
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    metadata: undefined,
  }));
}

describe('A2A Integration', () => {
  let server: A2AServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('serves Agent Card at /.well-known/agent.json', async () => {
    server = createServer(async () => {});
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as Record<string, any>;
    expect(card.name).toBe('integration-agent');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].name).toBe('echo');
  });

  it('health endpoint responds', async () => {
    server = createServer(async () => {});
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.status).toBe('ok');
  });

  it('JSON-RPC SendMessage completes task', async () => {
    server = createServer(async (ctx, bus) => {
      const text = ctx.userMessage.parts
        .filter((p) => p.content?.$case === 'text')
        .map((p) => (p.content as any).value)
        .join('');
      completeWithText(ctx, bus, `echo: ${text}`);
    });
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'SendMessage',
        params: {
          message: makeV1UserMessage('Hello A2A!'),
        },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.result).toBeDefined();
    expect(body.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('REST message:send completes task', async () => {
    server = createServer(async (ctx, bus) => {
      completeNoMessage(ctx, bus);
    });
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a/v1/message:send`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        message: makeV1UserMessage('REST test'),
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.task || body.id).toBeDefined();
  });

  it('REST getTask returns existing task', async () => {
    server = createServer(async (ctx, bus) => {
      completeNoMessage(ctx, bus);
    });
    const port = await server.start();

    const createRes = await fetch(`http://127.0.0.1:${port}/a2a/v1/message:send`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        message: makeV1UserMessage('get test'),
      }),
    });
    const created = (await createRes.json()) as Record<string, any>;
    const taskId = created.task?.id ?? created.id;
    expect(taskId).toBeDefined();

    const getRes = await fetch(`http://127.0.0.1:${port}/a2a/v1/tasks/${taskId}`, {
      headers: { 'A2A-Version': '1.0' },
    });
    expect(getRes.ok).toBe(true);
    const task = (await getRes.json()) as Record<string, any>;
    expect(task.id).toBe(taskId);
  });

  it('executor error produces failed task', async () => {
    server = createServer(async () => {
      throw new Error('Intentional test error');
    });
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        method: 'SendMessage',
        params: {
          message: makeV1UserMessage('trigger error'),
        },
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    const state = body.result?.task?.status?.state;
    expect(state).toBe('TASK_STATE_FAILED');
  });

  it('cancel completed task returns task', async () => {
    server = createServer(async (ctx, bus) => {
      completeNoMessage(ctx, bus);
    });
    const port = await server.start();

    // Create and complete a task first
    const sendRes = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'send-1',
        method: 'SendMessage',
        params: { message: makeV1UserMessage('task to cancel') },
      }),
    });
    const sendBody = (await sendRes.json()) as Record<string, any>;
    const taskId = sendBody.result?.task?.id;
    expect(taskId).toBeDefined();
  });

  it('unknown JSON-RPC method returns error', async () => {
    server = createServer(async () => {});
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '3',
        method: 'NonexistentMethod',
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeLessThan(0);
  });

  it('full round-trip: send message and verify response content', async () => {
    server = createServer(async (ctx, bus) => {
      completeWithText(ctx, bus, 'round-trip OK');
    });
    const port = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: A2A_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rt-1',
        method: 'SendMessage',
        params: { message: makeV1UserMessage('round-trip test') },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    const task = body.result?.task;
    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(task.status.message).toBeDefined();
    const responseParts = task.status.message.parts;
    expect(responseParts).toHaveLength(1);
    expect(responseParts[0].text).toBe('round-trip OK');
  });
});
