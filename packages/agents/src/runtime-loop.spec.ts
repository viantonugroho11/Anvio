import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ModelProvider, RuntimeToolPort, StreamChunk } from '@anvio/core';
import { runAgentLoop, type AgentLoopResult } from './runtime-loop.js';
import { runToolRound } from './tool-executor.js';
import { approvalRequiredChunk, toApprovalRequest } from './approval-node.js';

const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

function providerFromScripts(scripts: StreamChunk[][]): ModelProvider {
  let call = 0;
  return {
    providerId: 'fake',
    supportsNativeTools: true,
    chat: vi.fn(),
    stream: (async function* () {
      const chunks = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      for (const c of chunks) yield c;
    }) as ModelProvider['stream'],
  } as unknown as ModelProvider;
}

function toolPort(overrides: Partial<RuntimeToolPort> = {}): RuntimeToolPort {
  return {
    listTools: () => ['anvio_tools__file_read'],
    getToolInstructions: () => '',
    getModelToolDefinitions: () => [],
    call: vi.fn(async () => ({ status: 'completed', output: { ok: true } })),
    ...overrides,
  } as unknown as RuntimeToolPort;
}

async function drain(gen: ReturnType<typeof runAgentLoop>) {
  const chunks: unknown[] = [];
  let result: AgentLoopResult;
  // consume manually to capture generator return value
  for (;;) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    chunks.push(next.value);
  }
  return { chunks, result };
}

function baseInput(provider: ModelProvider, port?: RuntimeToolPort) {
  return {
    modelProvider: provider,
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }] as ChatMessage[],
    toolPort: port,
    toolCtx: { sessionId: 's1', agentId: 'a1', userId: 'u1' },
    useNativeTools: false,
    startIteration: 0,
    maxIterations: 5,
    initialUsage: { ...USAGE, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    shouldStop: () => false,
  };
}

describe('runAgentLoop', () => {
  it('completes with streamed content when no tool port', async () => {
    const provider = providerFromScripts([
      [
        { type: 'text_delta', delta: 'hello ' },
        { type: 'text_delta', delta: 'world' },
        { type: 'done', usage: USAGE },
      ],
    ]);
    const { chunks, result } = await drain(runAgentLoop(baseInput(provider)));
    expect(result.outcome).toBe('completed');
    expect(result.fullContent).toBe('hello world');
    expect(result.usage).toEqual(USAGE);
    expect(chunks.filter((c) => (c as { type: string }).type === 'chunk')).toHaveLength(2);
  });

  it('runs a native tool round then completes on next iteration', async () => {
    const provider = providerFromScripts([
      [
        { type: 'tool_use', toolCall: { id: 't1', name: 'file_read', arguments: { path: 'x' } } },
        { type: 'done', usage: USAGE },
      ],
      [{ type: 'text_delta', delta: 'done!' }, { type: 'done', usage: USAGE }],
    ]);
    const port = toolPort();
    const input = { ...baseInput(provider, port), useNativeTools: true };
    const { result } = await drain(runAgentLoop(input));
    expect(result.outcome).toBe('completed');
    expect(result.fullContent).toBe('done!');
    expect(port.call).toHaveBeenCalledTimes(1);
    // usage summed across both iterations
    expect(result.usage.totalTokens).toBe(30);
    // assistant tool message + tool result appended
    expect(result.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('suspends with approval_required chunk when a tool needs approval', async () => {
    const provider = providerFromScripts([
      [
        { type: 'tool_use', toolCall: { id: 't1', name: 'run_shell', arguments: { summary: 'rm x' } } },
        { type: 'done', usage: USAGE },
      ],
    ]);
    const port = toolPort({
      call: vi.fn(async () => ({
        name: 'run_shell',
        status: 'pending_approval',
        output: {},
        approvalRequestId: 'req-1',
      })),
    } as unknown as Partial<RuntimeToolPort>);
    const input = { ...baseInput(provider, port), useNativeTools: true };
    const { chunks, result } = await drain(runAgentLoop(input));
    expect(result.outcome).toBe('suspended');
    const approval = chunks.find((c) => (c as { type: string }).type === 'approval_required') as
      | ReturnType<typeof approvalRequiredChunk>
      | undefined;
    expect(approval?.request.id).toBe('req-1');
    expect(approval?.checkpoint).toMatchObject({ iteration: 1, approvalRequestId: 'req-1' });
  });

  it('stops between chunks when shouldStop flips', async () => {
    const provider = providerFromScripts([
      [{ type: 'text_delta', delta: 'a' }, { type: 'text_delta', delta: 'b' }, { type: 'done' }],
    ]);
    let calls = 0;
    const input = { ...baseInput(provider), shouldStop: () => ++calls > 1 };
    const { chunks, result } = await drain(runAgentLoop(input));
    expect(result.outcome).toBe('stopped');
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'Session stopped by user' });
  });

  it('propagates provider stream errors', async () => {
    const provider = providerFromScripts([[{ type: 'error', error: 'boom' }]]);
    const { result, chunks } = await drain(runAgentLoop(baseInput(provider)));
    expect(result.outcome).toBe('errored');
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'boom' });
  });
});

describe('runToolRound', () => {
  it('native path builds assistant message with toolCalls and role:tool results', async () => {
    const port = toolPort();
    const round = await runToolRound({
      toolPort: port,
      ctx: { sessionId: 's', agentId: 'a', userId: 'u' },
      assistantContent: 'thinking',
      toolCalls: [{ id: 't1', name: 'file_read', arguments: {} }],
      useNativeTools: true,
    });
    expect(round.hadTools).toBe(true);
    expect(round.assistantMessage.toolCalls).toHaveLength(1);
    expect(round.toolMessages[0]?.role).toBe('tool');
  });

  it('native mode with zero tool calls falls through to fenced parsing', async () => {
    const port = toolPort();
    const round = await runToolRound({
      toolPort: port,
      ctx: { sessionId: 's', agentId: 'a', userId: 'u' },
      assistantContent: 'no tools here',
      toolCalls: [],
      useNativeTools: true,
    });
    expect(round.hadTools).toBe(false);
    expect(port.call).not.toHaveBeenCalled();
  });
});

describe('toApprovalRequest', () => {
  it('maps pending approval to request with 24h expiry', () => {
    const before = Date.now();
    const req = toApprovalRequest({ requestId: 'r1', toolName: 'run_shell', summary: 'rm x' });
    expect(req).toMatchObject({ id: 'r1', toolName: 'run_shell', reason: 'rm x' });
    expect(req.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 86_400_000 - 1000);
  });
});
