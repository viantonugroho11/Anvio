import { describe, expect, it } from 'vitest';
import type {
  AgentDefinition,
  ChatMessage,
  ChatRequest,
  ModelProvider,
  Session,
  StreamChunk,
} from '@anvio/core';
import { FilesystemMemoryProvider } from '@anvio/memory';
import { ModelProviderRegistry } from '@anvio/models';
import { DefaultAgentRuntime, type AgentRuntimeDeps } from './runtime.js';

/** Just enough of FilesystemStorageProvider for the memory provider, kept in a Map. */
function memoryStorage() {
  const files = new Map<string, unknown>();
  return {
    rootPath: '/unused',
    readJson: async <T>(key: string) => (files.get(key) as T | undefined) ?? null,
    writeJson: async (key: string, value: unknown) => {
      files.set(key, structuredClone(value));
    },
    list: async (prefix: string) => [...files.keys()].filter((k) => k.startsWith(prefix)),
    delete: async (key: string) => {
      files.delete(key);
    },
  };
}

function provider(
  providerId: string,
  script: StreamChunk[],
  seen: Array<{ providerId: string; model?: string }> = [],
): ModelProvider {
  return {
    providerId,
    supportsNativeTools: false,
    chat: async () => {
      throw new Error('not used');
    },
    async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
      seen.push({ providerId, model: request.model });
      for (const chunk of script) yield chunk;
    },
  } as unknown as ModelProvider;
}

const OK: StreamChunk[] = [
  { type: 'text_delta', delta: 'ok' },
  { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
] as StreamChunk[];

function deps(overrides: Partial<AgentRuntimeDeps>): AgentRuntimeDeps {
  return {
    personaService: {
      getBySlug: async () => ({ spec: {} }),
      renderSystemPrompt: () => 'persona',
    },
    skillRegistry: {
      getBySlugs: async () => [],
      renderSkillInstructions: () => '',
    },
    memoryStore: {
      getContext: async () => ({ shortTerm: [] }),
      storeConversation: async () => {},
    },
    ...overrides,
  } as unknown as AgentRuntimeDeps;
}

const SESSION = {
  id: 's1',
  userId: 'u1',
  agentId: 'a1',
  channel: 'cli',
  state: { metadata: {} },
} as unknown as Session;

function agent(model: Record<string, unknown> = {}): AgentDefinition {
  return {
    spec: {
      persona: 'default',
      skills: [],
      model: { provider: 'anthropic', model: 'claude-x', maxTokens: 1024, ...model },
    },
  } as unknown as AgentDefinition;
}

async function drain(runtime: DefaultAgentRuntime, content: string, def = agent()) {
  const events: Array<{ type: string }> = [];
  for await (const event of runtime.stream(SESSION, def, { content })) events.push(event);
  return events;
}

const HISTORY: ChatMessage[] = [
  { role: 'user', content: 'turn1' },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'turn2' },
  { role: 'assistant', content: 'a2' },
];

describe('short-term history on a turn that does not complete (audit G-01, probe P5)', () => {
  it('keeps the earlier history and the new user message after a provider error', async () => {
    const memory = new FilesystemMemoryProvider(memoryStorage() as never);
    await memory.setMessages('s1', HISTORY);
    const failing = provider('anthropic', [
      { type: 'error', error: 'HTTP 500', retryable: false },
    ] as StreamChunk[]);
    const runtime = new DefaultAgentRuntime(
      deps({
        memoryStore: memory,
        modelProviders: {
          resolveForRoute: () => undefined,
          resolveForAgent: () => failing,
        } as unknown as AgentRuntimeDeps['modelProviders'],
      }),
    );

    const events = await drain(runtime, 'turn3');

    expect(events.at(-1)).toMatchObject({ type: 'error', error: 'HTTP 500' });
    expect(await memory.getMessages('s1')).toEqual([
      ...HISTORY,
      { role: 'user', content: 'turn3' },
    ]);
  });

  it('keeps history when the consumer stops reading mid-turn', async () => {
    const memory = new FilesystemMemoryProvider(memoryStorage() as never);
    await memory.setMessages('s1', HISTORY);
    const runtime = new DefaultAgentRuntime(
      deps({
        memoryStore: memory,
        modelProviders: {
          resolveForRoute: () => undefined,
          resolveForAgent: () => provider('anthropic', OK),
        } as unknown as AgentRuntimeDeps['modelProviders'],
      }),
    );

    for await (const event of runtime.stream(SESSION, agent(), { content: 'turn3' })) {
      if (event.type === 'chunk') break;
    }

    expect(await memory.getMessages('s1')).toEqual([
      ...HISTORY,
      { role: 'user', content: 'turn3' },
    ]);
  });

  it('stores the full turn once it completes', async () => {
    const memory = new FilesystemMemoryProvider(memoryStorage() as never);
    await memory.setMessages('s1', HISTORY);
    const runtime = new DefaultAgentRuntime(
      deps({
        memoryStore: memory,
        modelProviders: {
          resolveForRoute: () => undefined,
          resolveForAgent: () => provider('anthropic', OK),
        } as unknown as AgentRuntimeDeps['modelProviders'],
      }),
    );

    await drain(runtime, 'turn3');

    expect(await memory.getMessages('s1')).toEqual([
      ...HISTORY,
      { role: 'user', content: 'turn3' },
      { role: 'assistant', content: 'ok' },
    ]);
  });
});

describe('provider precedence (audit G-02, probe P3)', () => {
  function registry(seen: Array<{ providerId: string; model?: string }>) {
    return new ModelProviderRegistry(
      new Map([
        ['anthropic', provider('anthropic', OK, seen)],
        ['openai', provider('openai', OK, seen)],
      ]),
    );
  }

  it('keeps the agent provider and model when the message only sounds like coding', async () => {
    const seen: Array<{ providerId: string; model?: string }> = [];
    const runtime = new DefaultAgentRuntime(deps({ modelProviders: registry(seen) }));

    await drain(runtime, 'please implement a parser and review the PR');

    expect(seen).toEqual([{ providerId: 'anthropic', model: 'claude-x' }]);
  });

  it('follows an explicit model.routing opt-in without leaking the agent model id', async () => {
    const seen: Array<{ providerId: string; model?: string }> = [];
    const runtime = new DefaultAgentRuntime(deps({ modelProviders: registry(seen) }));

    await drain(runtime, 'hello', agent({ routing: 'coding' }));

    // coding prefers openai over anthropic; openai must not receive "claude-x"
    expect(seen).toEqual([{ providerId: 'openai', model: undefined }]);
  });

  it('keeps the agent model id when the opted-in route resolves to the agent provider', async () => {
    const seen: Array<{ providerId: string; model?: string }> = [];
    const runtime = new DefaultAgentRuntime(deps({ modelProviders: registry(seen) }));

    await drain(runtime, 'hello', agent({ routing: 'review' }));

    expect(seen).toEqual([{ providerId: 'anthropic', model: 'claude-x' }]);
  });
});
