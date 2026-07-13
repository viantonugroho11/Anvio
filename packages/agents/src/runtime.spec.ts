import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDefinition,
  MemoryStore,
  ModelProvider,
  Session,
  StreamChunk,
} from '@anvio/core';
import { DefaultAgentRuntime, type AgentRuntimeDeps } from './runtime.js';

const SESSION = {
  id: 'sess-1',
  agentId: 'tester',
  userId: 'u1',
  channel: 'cli',
  state: { metadata: {} },
} as unknown as Session;

const AGENT = {
  metadata: { slug: 'tester' },
  spec: {
    persona: 'helper',
    skills: [],
    model: { provider: 'anthropic', model: 'test-model' },
    memory: {},
  },
} as unknown as AgentDefinition;

function fakeProvider(chunks: StreamChunk[]): ModelProvider {
  return {
    providerId: 'fake',
    supportsNativeTools: false,
    chat: vi.fn(),
    stream: (async function* () {
      for (const c of chunks) yield c;
    }) as ModelProvider['stream'],
  } as unknown as ModelProvider;
}

function makeDeps(provider: ModelProvider): AgentRuntimeDeps {
  const memory: MemoryStore = {
    getContext: vi.fn(async () => ({ shortTerm: [], longTerm: [], semantic: [] })),
    storeConversation: vi.fn(async () => {}),
    storeEntry: vi.fn(async () => {}),
  } as unknown as MemoryStore;
  return {
    personaService: {
      getBySlug: vi.fn(async () => ({ metadata: { slug: 'helper' }, spec: {} })),
      renderSystemPrompt: vi.fn(() => 'You are a helpful test persona.'),
    } as unknown as AgentRuntimeDeps['personaService'],
    skillRegistry: {
      getBySlugs: vi.fn(async () => []),
      renderSkillInstructions: vi.fn(() => ''),
    } as unknown as AgentRuntimeDeps['skillRegistry'],
    memoryStore: memory,
    modelProviders: {
      resolveForAgent: vi.fn(() => provider),
      resolveForRoute: vi.fn(() => undefined),
    } as unknown as AgentRuntimeDeps['modelProviders'],
  };
}

async function collect(runtime: DefaultAgentRuntime, input = 'hello') {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of runtime.stream(SESSION, AGENT, { content: input })) {
    chunks.push(chunk as Record<string, unknown>);
  }
  return chunks;
}

describe('DefaultAgentRuntime', () => {
  it('streams model output and finishes with usage + promptHash (EVO-010)', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', delta: 'hi there' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ]);
    const runtime = new DefaultAgentRuntime(makeDeps(provider));
    const chunks = await collect(runtime);

    const done = chunks.find((c) => c.type === 'done');
    expect(done?.usage).toEqual({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    expect(done?.promptHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits a stable promptHash for identical inputs', async () => {
    const make = () =>
      new DefaultAgentRuntime(
        makeDeps(fakeProvider([{ type: 'text_delta', delta: 'x' }, { type: 'done' }])),
      );
    const h1 = (await collect(make())).find((c) => c.type === 'done')?.promptHash;
    const h2 = (await collect(make())).find((c) => c.type === 'done')?.promptHash;
    expect(h1).toBe(h2);
  });

  it('run() aggregates streamed content', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', delta: 'a' },
      { type: 'text_delta', delta: 'b' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]);
    const runtime = new DefaultAgentRuntime(makeDeps(provider));
    const result = await runtime.run(SESSION, AGENT, { content: 'hi' });
    expect(result.content).toBe('ab');
    expect(result.status).toBe('completed');
  });

  it('stop() aborts the next stream for that session', async () => {
    const provider = fakeProvider([{ type: 'text_delta', delta: 'never' }, { type: 'done' }]);
    const runtime = new DefaultAgentRuntime(makeDeps(provider));
    await runtime.stop(SESSION.id);
    const chunks = await collect(runtime);
    expect(chunks).toEqual([{ type: 'error', error: 'Session stopped by user' }]);
  });

  it('stores conversation on completion', async () => {
    const provider = fakeProvider([{ type: 'text_delta', delta: 'ok' }, { type: 'done' }]);
    const deps = makeDeps(provider);
    const runtime = new DefaultAgentRuntime(deps);
    await collect(runtime);
    // once for the user turn, once for the full transcript
    expect(deps.memoryStore.storeConversation).toHaveBeenCalledTimes(2);
  });
});
