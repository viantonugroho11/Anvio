import { describe, expect, it } from 'vitest';
import type { RuntimeRequest } from '@anvio/core';
import { ClaudeCodeRuntimeProvider } from './claude-code-runtime.js';

function mockRequest(content = 'Hello'): RuntimeRequest {
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
      },
    } as RuntimeRequest['agent'],
    input: { content },
  };
}

describe('ClaudeCodeRuntimeProvider', () => {
  it('is configured when OAuth token or broker resolver is present', () => {
    expect(new ClaudeCodeRuntimeProvider({ oauthToken: 'sk-ant-oat01-x' }).isConfigured()).toBe(true);
    expect(
      new ClaudeCodeRuntimeProvider({ resolveOAuthToken: async () => null }).isConfigured(),
    ).toBe(true);
    expect(new ClaudeCodeRuntimeProvider().isConfigured()).toBe(false);
  });

  it('runs via Agent SDK with mocked query stream', async () => {
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      queryImpl: () =>
        (async function* (): AsyncIterable<import('@anthropic-ai/claude-agent-sdk').SDKMessage> {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done from Claude Code',
            session_id: 'sdk-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            stop_reason: 'end_turn',
            total_cost_usd: 0,
            modelUsage: {},
            permission_denials: [],
            errors: [],
            uuid: '00000000-0000-4000-8000-000000000001',
          } as never;
        })(),
    });

    const result = await provider.run(mockRequest());
    expect(result.runtimeId).toBe('claude-code');
    expect(result.content).toBe('Done from Claude Code');
    expect(result.usage.totalTokens).toBe(15);
  });

  it('streams partial text deltas', async () => {
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      queryImpl: () =>
        (async function* (): AsyncIterable<import('@anthropic-ai/claude-agent-sdk').SDKMessage> {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hi' },
            },
            parent_tool_use_id: null,
            uuid: '00000000-0000-4000-8000-000000000002',
            session_id: 'sdk-session',
          } as never;
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Hi there',
            session_id: 'sdk-session',
            usage: { input_tokens: 1, output_tokens: 1 },
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            stop_reason: 'end_turn',
            total_cost_usd: 0,
            modelUsage: {},
            permission_denials: [],
            errors: [],
            uuid: '00000000-0000-4000-8000-000000000003',
          } as never;
        })(),
    });

    const chunks: string[] = [];
    for await (const event of provider.stream(mockRequest())) {
      if (event.type === 'chunk' && event.delta) chunks.push(event.delta);
    }
    expect(chunks.join('')).toContain('Hi');
  });
});
