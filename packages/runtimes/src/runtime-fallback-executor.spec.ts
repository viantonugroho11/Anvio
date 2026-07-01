import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDefinition,
  RuntimeProvider,
  RuntimeProviderId,
  RuntimeRequest,
} from '@anvio/core';
import { runWithRuntimeFallback } from './runtime-fallback-executor.js';

function mockRequest(): RuntimeRequest {
  return {
    session: {
      id: 'sess-1',
      userId: 'user-1',
      agentId: 'architect',
      channel: 'cli',
      state: { status: 'idle', messages: [] },
      lastActiveAt: new Date(),
    },
    agent: {
      apiVersion: 'anvio.io/v1',
      kind: 'Agent',
      metadata: { name: 'architect', version: '1.0.0' },
      spec: {
        description: 'Architect',
        persona: 'default',
        skills: [],
        tools: [],
        model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
        runtime: {
          provider: 'claude-code',
          fallbacks: ['cursor', 'local'],
        },
      },
    } as RuntimeRequest['agent'],
    input: { content: 'Hello' },
  };
}

function stubProvider(
  id: RuntimeProviderId,
  behavior: {
    configured?: boolean;
    run?: () => Promise<{ content: string; status: 'completed' | 'failed' }>;
  } = {},
): RuntimeProvider {
  return {
    runtimeId: id,
    capabilities: () => ({
      supportsTools: true,
      supportsStreaming: true,
      supportsSubagents: false,
      supportsMcp: false,
      supportedLanguages: [],
    }),
    isConfigured: () => behavior.configured ?? true,
    run: async (request) => {
      const outcome = behavior.run
        ? await behavior.run()
        : { content: `${id}: ${request.input.content}`, status: 'completed' as const };
      return {
        sessionId: request.session.id,
        content: outcome.content,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        status: outcome.status,
        runtimeId: id,
      };
    },
    stream: async function* () {
      yield { type: 'done' as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  };
}

describe('runWithRuntimeFallback', () => {
  it('skips unconfigured runtimes in chain', async () => {
    const factory = {
      get: vi.fn((id: RuntimeProviderId) => {
        if (id === 'claude-code') return stubProvider(id, { configured: false });
        if (id === 'cursor') return stubProvider(id, { configured: false });
        return stubProvider(id, { configured: true });
      }),
    };

    const result = await runWithRuntimeFallback(factory, mockRequest().agent, mockRequest());
    expect(result.runtimeId).toBe('local');
    expect(result.content).toBe('local: Hello');
    expect(result.failover).toBe(false);
  });

  it('failovers on auth error mid-run', async () => {
    const factory = {
      get: vi.fn((id: RuntimeProviderId) => {
        if (id === 'claude-code') {
          return stubProvider(id, {
            run: async () => {
              throw new Error('OAuth token expired');
            },
          });
        }
        return stubProvider(id);
      }),
    };

    const result = await runWithRuntimeFallback(factory, mockRequest().agent, mockRequest());
    expect(result.runtimeId).toBe('cursor');
    expect(result.failover).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.runtimeId).toBe('claude-code');
  });

  it('walks full chain A → B → C on repeated auth failures', async () => {
    const agent = mockRequest().agent;
    agent.spec.runtime = {
      provider: 'claude-code',
      fallbacks: ['cursor', 'local'],
    };

    const factory = {
      get: vi.fn((id: RuntimeProviderId) => {
        if (id === 'local') return stubProvider(id);
        return stubProvider(id, {
          run: async () => {
            throw new Error('401 Unauthorized — login required');
          },
        });
      }),
    };

    const result = await runWithRuntimeFallback(factory, agent, mockRequest());
    expect(result.runtimeId).toBe('local');
    expect(result.failover).toBe(true);
    expect(result.attempts.map((a) => a.runtimeId)).toEqual(['claude-code', 'cursor']);
  });
});
