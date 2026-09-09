import { describe, it, expect, afterEach } from 'vitest';
import { A2AServer, type A2AServerConfig } from './server/a2a-server.js';
import { TaskState } from '@a2a-js/sdk';
import { AgentEvent } from '@a2a-js/sdk/server';
import type { AgentDefinition } from '@anvio/core';

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
    onMessage: async (requestContext, eventBus) => {
      // Publish completed status
      eventBus.publish(AgentEvent.statusUpdate({
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }));
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
    const card = (await res.json()) as Record<string, any>;
    expect(card.name).toBe('test-agent');
    expect(card.capabilities.streaming).toBe(true);
  });

  it('serves health at /a2a/health', async () => {
    server = createTestServer();
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/a2a/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, any>;
    expect(body.status).toBe('ok');
  });
});
