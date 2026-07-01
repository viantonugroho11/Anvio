import { describe, expect, it } from 'vitest';
import type { RuntimeRequest } from '@anvio/core';
import { CodexRuntimeProvider } from './codex-runtime.js';

function mockRequest(content = 'Hello'): RuntimeRequest {
  return {
    session: {
      id: 'sess-codex',
      userId: 'user-1',
      agentId: 'coder',
      channel: 'cli',
      state: { status: 'idle', messages: [] },
      lastActiveAt: new Date(),
    },
    agent: {
      apiVersion: 'anvio.io/v1',
      kind: 'Agent',
      metadata: { name: 'coder', version: '1.0.0' },
      spec: {
        description: 'Coder',
        persona: 'default',
        skills: [],
        tools: [],
        model: { provider: 'openai', model: 'gpt-4o', maxTokens: 8192 },
        runtime: { provider: 'codex', fallback: 'local' },
      },
    } as RuntimeRequest['agent'],
    input: { content },
  };
}

describe('CodexRuntimeProvider', () => {
  it('is configured when broker resolver or env token is present', () => {
    expect(new CodexRuntimeProvider({ authJson: '{"access_token":"x"}' }).isConfigured()).toBe(true);
    expect(
      new CodexRuntimeProvider({ resolveConnectionPayload: async () => null }).isConfigured(),
    ).toBe(true);
    expect(new CodexRuntimeProvider().isConfigured()).toBe(false);
  });

  it('runs codex exec with mocked CLI', async () => {
    const provider = new CodexRuntimeProvider({
      authJson: JSON.stringify({ access_token: 'test-token' }),
      execImpl: async () => ({
        stdout: 'Codex done',
        stderr: '',
        exitCode: 0,
      }),
    });

    const result = await provider.run(mockRequest());
    expect(result.runtimeId).toBe('codex');
    expect(result.content).toBe('Codex done');
    expect(result.status).toBe('completed');
  });
});
