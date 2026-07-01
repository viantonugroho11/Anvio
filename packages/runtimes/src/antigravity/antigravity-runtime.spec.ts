import { describe, expect, it } from 'vitest';
import type { RuntimeRequest } from '@anvio/core';
import { AntigravityRuntimeProvider } from './antigravity-runtime.js';

function mockRequest(content = 'Hello'): RuntimeRequest {
  return {
    session: {
      id: 'sess-agy',
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
        model: { provider: 'gemini', model: 'gemini-2.0-flash', maxTokens: 8192 },
        runtime: { provider: 'antigravity', fallback: 'local' },
      },
    } as RuntimeRequest['agent'],
    input: { content },
  };
}

describe('AntigravityRuntimeProvider', () => {
  it('is configured when broker resolver or oauth token is present', () => {
    expect(new AntigravityRuntimeProvider({ oauthToken: 'token' }).isConfigured()).toBe(true);
    expect(
      new AntigravityRuntimeProvider({ resolveConnectionPayload: async () => null }).isConfigured(),
    ).toBe(true);
    expect(new AntigravityRuntimeProvider().isConfigured()).toBe(false);
  });

  it('runs agy -p with mocked CLI', async () => {
    const provider = new AntigravityRuntimeProvider({
      oauthToken: 'test-token',
      execImpl: async (opts) => {
        expect(opts.args).toEqual(['-p', 'Hello']);
        expect(opts.env?.ANTIGRAVITY_TOKEN).toBe('test-token');
        expect(opts.env?.GEMINI_API_KEY).toBeUndefined();
        return { stdout: 'Antigravity ok', stderr: '', exitCode: 0 };
      },
    });

    const result = await provider.run(mockRequest());
    expect(result.runtimeId).toBe('antigravity');
    expect(result.content).toBe('Antigravity ok');
  });
});
