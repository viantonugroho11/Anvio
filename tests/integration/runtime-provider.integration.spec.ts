import { describe, it, expect } from 'vitest';
import type { AgentDefinition, AgentRuntime, Session } from '@anvio/core';
import { AnvioError } from '@anvio/core';
import { createRuntimeFactory } from '@anvio/runtimes';

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

function createMockRuntime(): AgentRuntime {
  return {
    async run(session, _agent, input) {
      return {
        sessionId: session.id,
        content: `local: ${input.content}`,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        status: 'completed',
      };
    },
    async *stream(session, _agent, input) {
      yield { type: 'chunk', delta: `local: ${input.content}` };
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
    async resume() {
      return {
        sessionId: 's',
        content: 'resumed',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        status: 'completed',
      };
    },
  };
}

const session: Session = {
  id: 'sess-1',
  userId: 'user-1',
  agentId: 'architect',
  channel: 'cli',
  state: { status: 'idle', messages: [] },
  lastActiveAt: new Date(),
};

describe('Runtime Providers', () => {
  it('local runtime preserves agent behavior', async () => {
    const factory = createRuntimeFactory({ agentRuntime: createMockRuntime() });
    const provider = factory.get('local');
    const result = await provider.run({
      session,
      agent: mockAgent('architect'),
      input: { content: 'Hello' },
    });
    expect(result.runtimeId).toBe('local');
    expect(result.content).toBe('local: Hello');
  });

  it('unconfigured cursor falls back to local via resolveForAgent', async () => {
    const factory = createRuntimeFactory({ agentRuntime: createMockRuntime() });
    const agent = {
      ...mockAgent('architect'),
      spec: {
        ...mockAgent('architect').spec,
        runtime: { provider: 'cursor', fallback: 'local' },
      },
    };
    const provider = factory.resolveForAgent(agent);
    expect(provider.runtimeId).toBe('local');
  });

  it('reports runtime capabilities', () => {
    const factory = createRuntimeFactory({ agentRuntime: createMockRuntime() });
    const local = factory.get('local');
    expect(local.capabilities().supportsStreaming).toBe(true);
    expect(local.isConfigured()).toBe(true);
  });

  it('cursor stub returns not-configured when invoked directly', async () => {
    const factory = createRuntimeFactory({ agentRuntime: createMockRuntime() });
    const cursor = factory.get('cursor');
    expect(cursor.isConfigured()).toBe(false);
    await expect(
      cursor.run({ session, agent: mockAgent('architect'), input: { content: 'Hi' } }),
    ).rejects.toThrow(AnvioError);
  });

  it('claude-code is configured when OAuth token is available', () => {
    const factory = createRuntimeFactory({
      agentRuntime: createMockRuntime(),
      options: { claudeCodeOAuthToken: 'sk-ant-oat01-test' },
    });
    const claude = factory.get('claude-code');
    expect(claude.isConfigured()).toBe(true);
    expect(claude.capabilities().supportsSubagents).toBe(true);
  });

  it('resolves third hop in chain when earlier runtimes are unconfigured', () => {
    const factory = createRuntimeFactory({
      agentRuntime: createMockRuntime(),
      options: { claudeCodeOAuthToken: 'sk-ant-oat01-test' },
    });
    const agent = {
      ...mockAgent('architect'),
      spec: {
        ...mockAgent('architect').spec,
        runtime: {
          provider: 'cursor',
          fallbacks: ['claude-code', 'local'],
        },
      },
    };
    const provider = factory.resolveForAgent(agent);
    expect(provider.runtimeId).toBe('claude-code');
    expect(factory.resolveChainForAgent(agent)).toEqual(['cursor', 'claude-code', 'local']);
  });
});
