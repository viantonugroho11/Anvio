import { describe, expect, it } from 'vitest';
import type { AgentDefinition, AgentRuntime, Session } from '@anvio/core';
import { createRuntimeFactory } from '@anvio/runtimes';
import { RuntimeRoutingAgentRuntime } from './runtime-routing-agent-runtime.js';

function mockAgent(runtime?: AgentDefinition['spec']['runtime']): AgentDefinition {
  return {
    apiVersion: 'anvio.io/v1',
    kind: 'Agent',
    metadata: { name: 'architect', version: '1.0.0' },
    spec: {
      description: 'architect',
      persona: 'default',
      skills: [],
      tools: [],
      model: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
      runtime,
    },
  };
}

function createMockLocalRuntime(): AgentRuntime {
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

describe('RuntimeRoutingAgentRuntime', () => {
  it('selects claude-code runtime when OAuth is configured', () => {
    const local = createMockLocalRuntime();
    const factory = createRuntimeFactory({
      agentRuntime: local,
      options: {
        claudeCodeOAuthToken: 'sk-ant-oat01-test',
      },
    });
    const routing = new RuntimeRoutingAgentRuntime(local, factory, 'local');
    const agent = mockAgent({ provider: 'claude-code', fallback: 'local' });
    const provider = factory.resolveForAgent(agent, 'local');
    expect(provider.runtimeId).toBe('claude-code');
    expect(routing).toBeDefined();
  });

  it('falls back to local runtime when claude-code is not configured', async () => {
    const local = createMockLocalRuntime();
    const factory = createRuntimeFactory({ agentRuntime: local });
    const routing = new RuntimeRoutingAgentRuntime(local, factory, 'local');
    const agent = mockAgent({ provider: 'claude-code', fallback: 'local' });

    const result = await routing.run(session, agent, { content: 'Hello' });
    expect(result.content).toBe('local: Hello');
  });
});
