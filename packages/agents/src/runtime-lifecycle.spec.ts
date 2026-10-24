import { describe, expect, it } from 'vitest';
import type {
  AgentDefinition,
  AgentStreamEvent,
  BuiltinToolCall,
  BuiltinToolResult,
  ChatMessage,
  ChatRequest,
  ModelToolDefinition,
  RuntimeToolPort,
  Session,
  StreamChunk,
} from '@anvio/core';
import {
  DefaultAgentRuntime,
  guardStream,
  ModelIdleTimeoutError,
  type AgentRuntimeDeps,
} from './runtime.js';

type Script = StreamChunk[] | ((request: ChatRequest) => AsyncIterable<StreamChunk>);

/** Provider that plays one script per model call, recording each request. */
function scriptedProvider(scripts: Script[], native = true) {
  const requests: ChatRequest[] = [];
  let call = 0;
  return {
    requests,
    provider: {
      providerId: 'anthropic',
      supportsNativeTools: native,
      chat: async () => {
        throw new Error('not used');
      },
      stream(request: ChatRequest): AsyncIterable<StreamChunk> {
        requests.push(structuredClone({ ...request, signal: undefined }));
        const script = scripts[Math.min(call++, scripts.length - 1)]!;
        if (typeof script === 'function') return script(request);
        return (async function* () {
          for (const chunk of script) yield chunk;
        })();
      },
    },
  };
}

function toolPort(options: { pendingFor?: string; slowFor?: string } = {}) {
  const calls: BuiltinToolCall[] = [];
  const port: RuntimeToolPort = {
    listTools: () => ['anvio_tools__write', 'anvio_tools__read', 'anvio_tools__notify'],
    getToolInstructions: () => 'tools',
    getModelToolDefinitions: (): ModelToolDefinition[] => [
      { name: 'anvio_tools__write', description: 'w', inputSchema: { type: 'object' } },
    ],
    async call(call, ctx): Promise<BuiltinToolResult> {
      calls.push(call);
      if (call.name === options.slowFor) {
        await new Promise((resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => reject(ctx.signal!.reason), { once: true });
          setTimeout(resolve, 10_000);
        });
      }
      if (call.name === options.pendingFor) {
        return {
          name: call.name,
          output: { summary: 'notify the team' },
          status: 'pending_approval',
          approvalRequestId: 'apr-1',
        };
      }
      return { name: call.name, output: `${call.name} ok`, status: 'completed' };
    },
  };
  return { port, calls };
}

function memory() {
  const stored: ChatMessage[][] = [];
  return {
    stored,
    store: {
      getContext: async () => ({ shortTerm: [] as ChatMessage[], longTerm: [], semantic: [] }),
      storeConversation: async (_s: string, _u: string, messages: ChatMessage[]) => {
        stored.push(messages);
      },
    },
  };
}

function deps(overrides: Partial<AgentRuntimeDeps> & { provider: unknown }): AgentRuntimeDeps {
  const { provider, ...rest } = overrides;
  return {
    personaService: { getBySlug: async () => ({ spec: {} }), renderSystemPrompt: () => 'persona' },
    skillRegistry: { getBySlugs: async () => [], renderSkillInstructions: () => '' },
    memoryStore: memory().store,
    modelProviders: { resolveForRoute: () => undefined, resolveForAgent: () => provider },
    warn: () => {},
    ...rest,
  } as unknown as AgentRuntimeDeps;
}

function session(metadata: Record<string, unknown> = {}): Session {
  return {
    id: 's1',
    userId: 'u1',
    agentId: 'a1',
    channel: 'cli',
    state: { status: 'idle', messages: [], metadata },
    lastActiveAt: new Date(),
  };
}

const AGENT = {
  spec: {
    persona: 'default',
    skills: [],
    model: { provider: 'anthropic', model: 'm', maxTokens: 1024, temperature: 0 },
  },
} as unknown as AgentDefinition;

async function collect(stream: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  id,
  name,
  arguments: args,
});

describe('approval pause mid-batch (CQ-004)', () => {
  it('checkpoints the assistant turn and every result, so resume does not re-run completed tools', async () => {
    const { provider, requests } = scriptedProvider([
      [
        {
          type: 'done',
          toolCalls: [
            call('c1', 'anvio_tools__write', { path: 'a' }),
            call('c2', 'anvio_tools__notify', { summary: 'notify the team' }),
            call('c3', 'anvio_tools__read'),
          ],
        },
      ],
      [{ type: 'text_delta', delta: 'all done' }, { type: 'done' }],
    ]);
    const tools = toolPort({ pendingFor: 'anvio_tools__notify' });
    const runtime = new DefaultAgentRuntime(deps({ provider, toolPort: tools.port }));

    const first = await collect(runtime.stream(session(), AGENT, { content: 'go' }));
    const paused = first.find((e) => e.type === 'approval_required');
    expect(paused).toBeDefined();
    expect(tools.calls.map((c) => c.name)).toEqual(['anvio_tools__write', 'anvio_tools__notify']);

    const checkpoint = (paused as Extract<AgentStreamEvent, { type: 'approval_required' }>)
      .checkpoint!;
    const saved = checkpoint.messages as ChatMessage[];
    expect(checkpoint.version).toBe(2);
    expect(saved.at(-4)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    });
    expect(saved.at(-3)).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: expect.stringContaining('anvio_tools__write ok'),
    });
    expect(saved.at(-2)).toMatchObject({
      role: 'tool',
      toolCallId: 'c2',
      content: expect.stringContaining('awaiting human approval'),
    });
    expect(saved.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c3',
      content: expect.stringContaining('Not executed'),
    });

    const resumed = await collect(
      runtime.stream(session({ agentRunCheckpoint: checkpoint }), AGENT, {
        content: '',
        metadata: { resumeDecision: { requestId: 'apr-1', approved: true } },
      }),
    );
    expect(resumed.at(-1)).toMatchObject({ type: 'done' });
    // Completed tools were not executed again; the model saw their results.
    expect(tools.calls.filter((c) => c.name === 'anvio_tools__write')).toHaveLength(1);
    const resumeRequest = requests[1]!;
    expect(
      resumeRequest.messages.some(
        (m) => m.role === 'tool' && m.content.includes('anvio_tools__write ok'),
      ),
    ).toBe(true);
    expect(resumeRequest.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Human approval granted'),
    });
  });

  it('works the same for fenced (parsed) tool calls', async () => {
    const fenced = (name: string) =>
      '```anvio_tool\n' + JSON.stringify({ name, arguments: {} }) + '\n```';
    const { provider } = scriptedProvider(
      [
        [
          {
            type: 'text_delta',
            delta: `${fenced('anvio_tools__write')}\n${fenced('anvio_tools__notify')}`,
          },
          { type: 'done' },
        ],
      ],
      false,
    );
    const tools = toolPort({ pendingFor: 'anvio_tools__notify' });
    const runtime = new DefaultAgentRuntime(deps({ provider, toolPort: tools.port }));
    const events = await collect(runtime.stream(session(), AGENT, { content: 'go' }));
    const paused = events.find((e) => e.type === 'approval_required') as Extract<
      AgentStreamEvent,
      { type: 'approval_required' }
    >;
    const saved = paused.checkpoint!.messages as ChatMessage[];
    expect(saved.at(-3)).toMatchObject({ role: 'assistant' });
    expect(saved.at(-2)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('anvio_tools__write ok'),
    });
    expect(saved.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('awaiting human approval'),
    });
  });

  it('refuses to resume without a valid checkpoint instead of running an empty turn', async () => {
    const { provider, requests } = scriptedProvider([[{ type: 'done' }]]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    const resume = {
      content: '',
      metadata: { resumeDecision: { requestId: 'x', approved: true } },
    };

    const missing = await collect(runtime.stream(session(), AGENT, resume));
    expect(missing.at(-1)).toMatchObject({ type: 'error', code: 'invalid_checkpoint' });

    const corrupt = await collect(
      runtime.stream(session({ agentRunCheckpoint: { messages: 'nope' } }), AGENT, resume),
    );
    expect(corrupt.at(-1)).toMatchObject({ type: 'error', code: 'invalid_checkpoint' });
    expect(requests).toHaveLength(0);
  });

  it('still reads version-1 checkpoints', async () => {
    const { provider } = scriptedProvider([
      [{ type: 'text_delta', delta: 'ok' }, { type: 'done' }],
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    const v1 = {
      messages: [{ role: 'user', content: 'earlier' }],
      iteration: 1,
      lastIterationContent: '',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      approvalRequestId: 'apr',
      approvalSummary: 'do it',
    };
    const events = await collect(
      runtime.stream(session({ agentRunCheckpoint: v1 }), AGENT, {
        content: '',
        metadata: { resumeDecision: { requestId: 'apr', approved: false } },
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});

describe('iteration limit (CQ-005)', () => {
  it('tells the user when the tool loop runs out of rounds', async () => {
    const { provider } = scriptedProvider([
      [{ type: 'done', toolCalls: [call('c', 'anvio_tools__read')] }],
    ]);
    const tools = toolPort();
    const runtime = new DefaultAgentRuntime(
      deps({ provider, toolPort: tools.port, maxToolIterations: 3 }),
    );
    const events = await collect(runtime.stream(session(), AGENT, { content: 'loop' }));
    const text = events.flatMap((e) => (e.type === 'chunk' ? [e.delta] : [])).join('');
    expect(text).toContain('Stopped after 3 tool rounds');
    expect(tools.calls).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'iteration_limit' });
  });

  it('reports a normal end_turn with the serving provider and model', async () => {
    const { provider } = scriptedProvider([
      [
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', provider: 'openai', model: 'gpt-x' },
      ],
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    const events = await collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      stopReason: 'end_turn',
      provider: 'openai',
      model: 'gpt-x',
    });
  });
});

describe('cancellation and timeouts (CQ-006)', () => {
  it('stop() interrupts a stalled model stream promptly', async () => {
    const { provider } = scriptedProvider([
      () =>
        (async function* () {
          yield { type: 'text_delta', delta: 'thinking' } as StreamChunk;
          await new Promise(() => {}); // never resolves
        })(),
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider, modelIdleTimeoutMs: 0 }));
    const pending = collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.isRunning('s1')).toBe(true);
    const started = Date.now();
    await runtime.stop('s1');
    const events = await pending;
    expect(Date.now() - started).toBeLessThan(500);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'stopped',
      error: 'Session stopped by user',
    });
    expect(runtime.isRunning('s1')).toBe(false);
  });

  it('stop() interrupts a running tool and passes the signal to it', async () => {
    const { provider } = scriptedProvider([
      [{ type: 'done', toolCalls: [call('c', 'anvio_tools__write')] }],
    ]);
    const tools = toolPort({ slowFor: 'anvio_tools__write' });
    const runtime = new DefaultAgentRuntime(deps({ provider, toolPort: tools.port }));
    const pending = collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runtime.stop('s1');
    const events = await pending;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'stopped' });
  });

  it('a stop for an idle session does not cancel its next turn', async () => {
    const { provider } = scriptedProvider([
      [{ type: 'text_delta', delta: 'ok' }, { type: 'done' }],
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    await runtime.stop('s1');
    const events = await collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('gives up on a model stream that goes silent before any output', async () => {
    const { provider } = scriptedProvider([
      () =>
        (async function* () {
          await new Promise(() => {});
          yield { type: 'done' } as StreamChunk;
        })(),
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider, modelIdleTimeoutMs: 50 }));
    const events = await collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'model_idle_timeout',
      retryable: true,
    });
  });

  it('keeps partial output when the stream goes silent mid-answer', async () => {
    const { provider } = scriptedProvider([
      () =>
        (async function* () {
          yield { type: 'text_delta', delta: 'half an answer' } as StreamChunk;
          await new Promise(() => {});
        })(),
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider, modelIdleTimeoutMs: 50 }));
    const events = await collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    const text = events.flatMap((e) => (e.type === 'chunk' ? [e.delta] : [])).join('');
    expect(text).toContain('half an answer');
    expect(text).toContain('Response interrupted');
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'interrupted' });
  });

  it('passes an abort signal to the provider request', async () => {
    let seen: AbortSignal | undefined;
    const { provider } = scriptedProvider([
      (request) => {
        seen = request.signal;
        return (async function* () {
          yield { type: 'done' } as StreamChunk;
        })();
      },
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    await collect(runtime.stream(session(), AGENT, { content: 'hi' }));
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});

describe('session isolation', () => {
  it('rejects a second concurrent turn on the same session', async () => {
    const { provider } = scriptedProvider([
      () =>
        (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield { type: 'done' } as StreamChunk;
        })(),
    ]);
    const runtime = new DefaultAgentRuntime(deps({ provider }));
    const first = collect(runtime.stream(session(), AGENT, { content: 'one' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await collect(runtime.stream(session(), AGENT, { content: 'two' }));
    expect(second.at(-1)).toMatchObject({ type: 'error', code: 'session_busy' });
    expect((await first).at(-1)).toMatchObject({ type: 'done' });
  });
});

describe('guardStream', () => {
  it('fails with ModelIdleTimeoutError when the source stalls', async () => {
    const stalled = (async function* () {
      await new Promise(() => {});
      yield 1;
    })();
    const consume = async () => {
      for await (const _ of guardStream(stalled, { idleMs: 20 })) void _;
    };
    await expect(consume()).rejects.toBeInstanceOf(ModelIdleTimeoutError);
  });
});
