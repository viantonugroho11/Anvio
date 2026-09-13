import { describe, expect, it, vi } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type {
  BuiltinToolCall,
  RuntimeApprovalPort,
  RuntimeRequest,
  RuntimeToolPort,
} from '@anvio/core';
import { ClaudeCodeRuntimeProvider } from './claude-code-runtime.js';
import {
  buildAnvioToolDefinitions,
  jsonSchemaToZodShape,
  mcpToolName,
} from './claude-code-tool-bridge.js';

function mockRequest(): RuntimeRequest {
  return {
    session: {
      id: 'sess-1',
      userId: 'telegram:1',
      agentId: 'architect',
      channel: 'telegram',
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
    input: { content: 'deploy the thing' },
  };
}

function emptyResultStream() {
  return (async function* (): AsyncIterable<import('@anthropic-ai/claude-agent-sdk').SDKMessage> {
    yield {
      type: 'result',
      subtype: 'success',
      result: 'ok',
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
      uuid: '00000000-0000-4000-8000-000000000002',
    } as never;
  })();
}

function toolPortStub(call = vi.fn()): RuntimeToolPort {
  return {
    listTools: () => ['anvio_channel__reply'],
    getToolInstructions: () => 'HARNESS INSTRUCTIONS',
    getModelToolDefinitions: () => [
      {
        name: 'anvio_channel__reply',
        description: 'Send a reply',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
    call: call as unknown as RuntimeToolPort['call'],
  };
}

/** Capture the Options the runtime hands the SDK. */
async function captureOptions(
  provider: ClaudeCodeRuntimeProvider,
  seen: { options?: Options },
): Promise<void> {
  await provider.run(mockRequest());
  expect(seen.options).toBeDefined();
}

describe('claude-code harness wiring (issue #69)', () => {
  it('serves the tool port as an MCP server and appends its instructions', async () => {
    const seen: { options?: Options } = {};
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      toolPort: toolPortStub(),
      queryImpl: (params) => {
        seen.options = params.options;
        return emptyResultStream();
      },
    });

    await captureOptions(provider, seen);

    expect(seen.options?.mcpServers).toHaveProperty('anvio');
    expect(seen.options?.allowedTools).toEqual([mcpToolName('anvio_channel__reply')]);
    expect(seen.options?.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      append: 'HARNESS INSTRUCTIONS',
    });
  });

  it('leaves the SDK options untouched when no tool port is supplied', async () => {
    const seen: { options?: Options } = {};
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      queryImpl: (params) => {
        seen.options = params.options;
        return emptyResultStream();
      },
    });

    await captureOptions(provider, seen);

    expect(seen.options?.mcpServers).toBeUndefined();
    expect(seen.options?.systemPrompt).toBeUndefined();
    expect(seen.options?.canUseTool).toBeUndefined();
  });

  it('routes SDK tool permission prompts through the approval port', async () => {
    const requestApproval = vi.fn(async () => ({ approved: true }));
    const approvalPort: RuntimeApprovalPort = { requestApproval };
    const seen: { options?: Options } = {};
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      approvalPort,
      queryImpl: (params) => {
        seen.options = params.options;
        return emptyResultStream();
      },
    });

    await captureOptions(provider, seen);

    const decision = await seen.options!.canUseTool!('Bash', { command: 'rm -rf /' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
      requestId: 'rq-1',
    } as never);

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        channel: 'telegram',
        toolName: 'Bash',
        summary: 'Run Bash: rm -rf /',
      }),
    );
    expect(decision).toMatchObject({ behavior: 'allow' });
  });

  it('denies the tool when approval is refused, and when the gate throws', async () => {
    const seen: { options?: Options } = {};
    let outcome: { approved: boolean; reason?: string } | Error = {
      approved: false,
      reason: 'nope',
    };
    const provider = new ClaudeCodeRuntimeProvider({
      oauthToken: 'sk-ant-oat01-test',
      approvalPort: {
        requestApproval: async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
      },
      queryImpl: (params) => {
        seen.options = params.options;
        return emptyResultStream();
      },
    });

    await captureOptions(provider, seen);
    const ctx = {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
      requestId: 'rq-1',
    } as never;

    await expect(seen.options!.canUseTool!('Bash', {}, ctx)).resolves.toMatchObject({
      behavior: 'deny',
      message: 'nope',
    });

    outcome = new Error('gate exploded');
    await expect(seen.options!.canUseTool!('Bash', {}, ctx)).resolves.toMatchObject({
      behavior: 'deny',
      message: 'gate exploded',
    });
  });
});

describe('jsonSchemaToZodShape', () => {
  it('marks non-required properties optional and keeps required ones', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: { text: { type: 'string' }, count: { type: 'number' } },
      required: ['text'],
    });

    expect(shape.text!.safeParse('hi').success).toBe(true);
    expect(shape.text!.safeParse(undefined).success).toBe(false);
    expect(shape.count!.safeParse(undefined).success).toBe(true);
    expect(shape.count!.safeParse('nope').success).toBe(false);
  });

  it('falls back to a permissive type for unknown schemas', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: { anything: {} },
      required: ['anything'],
    });
    expect(shape.anything!.safeParse({ deep: true }).success).toBe(true);
  });

  it('yields an empty shape for a schema with no properties', () => {
    expect(jsonSchemaToZodShape({ type: 'object' })).toEqual({});
  });
});

describe('mcpToolName', () => {
  it('namespaces a tool the way the SDK exposes it to the model', () => {
    expect(mcpToolName('anvio_channel__reply')).toBe('mcp__anvio__anvio_channel__reply');
  });
});

describe('anvio MCP tool handler', () => {
  it('forwards calls to the tool port with the session context', async () => {
    const call = vi.fn(async (c: BuiltinToolCall) => ({
      name: c.name,
      output: { delivered: true },
      status: 'completed' as const,
    }));

    const [definition] = buildAnvioToolDefinitions(toolPortStub(call), {
      sessionId: 'sess-1',
      agentId: 'architect',
      userId: 'telegram:1',
      channel: 'telegram',
    });

    expect(definition!.name).toBe('anvio_channel__reply');

    const result = await definition!.handler({ text: 'hi' } as never, undefined);

    expect(call).toHaveBeenCalledWith(
      { name: 'anvio_channel__reply', arguments: { text: 'hi' } },
      { sessionId: 'sess-1', agentId: 'architect', userId: 'telegram:1', channel: 'telegram' },
    );
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: '{"delivered":true}' }]);
  });

  it('reports a failed gateway call as an MCP tool error', async () => {
    const call = vi.fn(async (c: BuiltinToolCall) => ({
      name: c.name,
      output: null,
      status: 'failed' as const,
      error: 'channel unavailable',
    }));

    const [definition] = buildAnvioToolDefinitions(toolPortStub(call), {
      sessionId: 'sess-1',
      agentId: 'architect',
      channel: 'telegram',
    });

    const result = await definition!.handler({ text: 'hi' } as never, undefined);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'channel unavailable' }]);
  });
});
