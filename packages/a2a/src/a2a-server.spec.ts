import { describe, it, expect, afterEach } from 'vitest';
import { A2AServer, type A2AServerConfig } from './server/a2a-server.js';
import type { AgentDefinition } from '@anvio/core';
import type { AgentCard } from './types/agent-card.js';
import type { Task } from './types/task.js';

const AGENT: AgentDefinition = {
  apiVersion: 'anvio.io/v1',
  kind: 'Agent',
  metadata: { name: 'test-agent', version: '1.0.0' },
  spec: {
    description: 'Test agent',
    persona: 'You are a test agent.',
    skills: [],
    tools: [],
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
    memory: { shortTerm: { enabled: true, ttlSeconds: 3600 }, longTerm: { enabled: true }, semantic: { enabled: false } },
    orchestration: { pattern: 'single', delegates: [] },
    approvals: { requiredFor: ['destructive'] },
    workspace: { isolatedWorktree: false },
  },
};

function createTestServer(): A2AServer {
  const config: A2AServerConfig = {
    host: '127.0.0.1',
    port: 0,
    agents: [AGENT],
    cardOptions: { baseUrl: 'http://localhost:3001' },
    onMessage: async (taskId, _message, taskManager) => {
      taskManager.updateStatus(taskId, 'completed');
    },
  };
  return new A2AServer(config);
}

describe('A2AServer', () => {
  let server: A2AServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('starts and stops', async () => {
    server = createTestServer();
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(server.getStatus().running).toBe(true);
    await server.stop();
    expect(server.getStatus().running).toBe(false);
  });

  it('serves Agent Card at /.well-known/agent.json', async () => {
    server = createTestServer();
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as AgentCard;
    expect(card.agentId).toBe('test-agent');
    expect(card.capabilities.streaming).toBe(true);
  });

  it('serves health at /a2a/health', async () => {
    server = createTestServer();
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/a2a/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.protocol).toBe('a2a/v1.0');
  });

  it('handles JSON-RPC sendMessage', async () => {
    server = createTestServer();
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'sendMessage',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello A2A!' }],
          },
        },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.result.status.state).toBe('completed');
    expect(body.result.id).toMatch(/^task_/);
  });

  it('handles REST getTask', async () => {
    server = createTestServer();
    const port = await server.start();

    // Create a task first
    const createRes = await fetch(`http://127.0.0.1:${port}/a2a/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'msg-2',
          role: 'user',
          parts: [{ type: 'text', text: 'Test' }],
        },
      }),
    });
    const created = (await createRes.json()) as Task;

    // Get the task
    const getRes = await fetch(`http://127.0.0.1:${port}/a2a/tasks/${created.id}`);
    expect(getRes.ok).toBe(true);
    const task = (await getRes.json()) as Task;
    expect(task.id).toBe(created.id);
  });

  it('handles REST cancelTask', async () => {
    // Use a handler that stays in working state
    const config: A2AServerConfig = {
      host: '127.0.0.1',
      port: 0,
      agents: [AGENT],
      cardOptions: { baseUrl: 'http://localhost:3001' },
      onMessage: async () => {
        // intentionally don't complete — task stays in 'working'
        await new Promise((r) => setTimeout(r, 5000));
      },
    };
    server = new A2AServer(config);
    const port = await server.start();

    // Create task with returnImmediately
    const createRes = await fetch(`http://127.0.0.1:${port}/a2a/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'msg-3',
          role: 'user',
          parts: [{ type: 'text', text: 'Slow task' }],
        },
        configuration: { returnImmediately: true },
      }),
    });
    const task = (await createRes.json()) as Task;

    const cancelRes = await fetch(`http://127.0.0.1:${port}/a2a/tasks/${task.id}:cancel`, {
      method: 'POST',
    });
    expect(cancelRes.ok).toBe(true);
    const canceled = (await cancelRes.json()) as Task;
    expect(canceled.status.state).toBe('canceled');
  });

  it('returns 404 for unknown JSON-RPC method', async () => {
    server = createTestServer();
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        method: 'nonexistent',
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    expect(body.error.code).toBe(-32601);
  });
});
