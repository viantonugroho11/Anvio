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

  it('passes spec.runtime.model to the SDK instead of spec.model.model', async () => {
    let captured: unknown = undefined;
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      queryImpl: ({ options }) => {
        captured = options?.model;
        return (async function* (): AsyncIterable<
          import('@anthropic-ai/claude-agent-sdk').SDKMessage
        > {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'ok',
            session_id: 'sdk',
            usage: { input_tokens: 0, output_tokens: 0 },
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            stop_reason: 'end_turn',
            total_cost_usd: 0,
            modelUsage: {},
            permission_denials: [],
            errors: [],
            uuid: '00000000-0000-4000-8000-000000000010',
          } as never;
        })();
      },
    });

    const request = mockRequest();
    // deepseek in spec.model, sonnet under runtime.model — vendor gets sonnet.
    request.agent.spec.model = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      maxTokens: 8192,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    };
    request.agent.spec.runtime = { provider: 'claude-code', model: 'sonnet' };
    await provider.run(request);
    expect(captured).toBe('sonnet');
  });

  it('does not forward a non-Anthropic spec.model.model when runtime.model is absent', async () => {
    let captured: unknown = 'unset';
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      queryImpl: ({ options }) => {
        captured = options?.model;
        return (async function* (): AsyncIterable<
          import('@anthropic-ai/claude-agent-sdk').SDKMessage
        > {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'ok',
            session_id: 'sdk',
            usage: { input_tokens: 0, output_tokens: 0 },
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            stop_reason: 'end_turn',
            total_cost_usd: 0,
            modelUsage: {},
            permission_denials: [],
            errors: [],
            uuid: '00000000-0000-4000-8000-000000000011',
          } as never;
        })();
      },
    });

    const request = mockRequest();
    request.agent.spec.model = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      maxTokens: 8192,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    };
    await provider.run(request);
    expect(captured).toBeUndefined();
  });
  describe('conversation continuity (issue #63)', () => {
    function successResult(sessionId = 'sdk-session') {
      return {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: sessionId,
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
        uuid: '00000000-0000-4000-8000-000000000020',
      } as never;
    }

    function stub(onCall: (params: { prompt: string; options?: { resume?: string } }) => void) {
      return new ClaudeCodeRuntimeProvider({
        oauthToken: 'sk-ant-oat01-test',
        queryImpl: (params) => {
          onCall(params as { prompt: string; options?: { resume?: string } });
          return (async function* (): AsyncIterable<
            import('@anthropic-ai/claude-agent-sdk').SDKMessage
          > {
            yield successResult();
          })();
        },
      });
    }

    it('reports native resume support', () => {
      expect(new ClaudeCodeRuntimeProvider().capabilities().supportsNativeResume).toBe(true);
    });

    it('returns the SDK session id so the gateway can persist it', async () => {
      const provider = stub(() => {});
      const result = await provider.run(mockRequest());
      expect(result.vendorSessionId).toBe('sdk-session');
    });

    it('emits the vendor session id and runtime id on the done event', async () => {
      const provider = stub(() => {});
      const events = [];
      for await (const event of provider.stream(mockRequest())) events.push(event);
      const done = events.find((e) => e.type === 'done');
      expect(done).toMatchObject({ vendorSessionId: 'sdk-session', runtimeId: 'claude-code' });
    });

    it('resumes the stored transcript instead of replaying history', async () => {
      let seen: { prompt: string; options?: { resume?: string } } | undefined;
      const provider = stub((params) => {
        seen = params;
      });

      const request = mockRequest('and what did I say before?');
      request.session.state.messages = [{ role: 'user', content: 'my name is Vianto' }];
      request.session.state.metadata = { vendorSessions: { 'claude-code': 'sdk-prev' } };
      await provider.run(request);

      expect(seen?.options?.resume).toBe('sdk-prev');
      // The SDK already holds the transcript — resending it would double the cost.
      expect(seen?.prompt).toBe('and what did I say before?');
    });

    it('replays history as a prelude when there is no stored handle', async () => {
      let seen: { prompt: string; options?: { resume?: string } } | undefined;
      const provider = stub((params) => {
        seen = params;
      });

      const request = mockRequest('and what did I say before?');
      request.session.state.messages = [{ role: 'user', content: 'my name is Vianto' }];
      await provider.run(request);

      expect(seen?.options?.resume).toBeUndefined();
      expect(seen?.prompt).toContain('my name is Vianto');
    });

    it('falls back to a cold start when the stored handle is stale', async () => {
      const calls: Array<{ prompt: string; options?: { resume?: string } }> = [];
      const provider = new ClaudeCodeRuntimeProvider({
        oauthToken: 'sk-ant-oat01-test',
        queryImpl: (params) => {
          calls.push(params as { prompt: string; options?: { resume?: string } });
          return (async function* (): AsyncIterable<
            import('@anthropic-ai/claude-agent-sdk').SDKMessage
          > {
            if ((params.options as { resume?: string } | undefined)?.resume) {
              throw new Error('No conversation found with session ID: sdk-gone');
            }
            yield successResult('sdk-fresh');
          })();
        },
      });

      const request = mockRequest('still there?');
      request.session.state.messages = [{ role: 'user', content: 'my name is Vianto' }];
      request.session.state.metadata = { vendorSessions: { 'claude-code': 'sdk-gone' } };
      const result = await provider.run(request);

      expect(calls).toHaveLength(2);
      expect(calls[1]?.options?.resume).toBeUndefined();
      expect(calls[1]?.prompt).toContain('my name is Vianto');
      expect(result.vendorSessionId).toBe('sdk-fresh');
    });
  });
});
