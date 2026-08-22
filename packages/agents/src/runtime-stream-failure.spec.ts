import { describe, expect, it } from 'vitest';
import type { AgentDefinition, Session, StreamChunk, UserInput } from '@anvio/core';
import { DefaultAgentRuntime, type AgentRuntimeDeps } from './runtime.js';

/** Provider that replays a fixed chunk script. */
function scriptedProvider(script: StreamChunk[]) {
  return {
    providerId: 'anthropic',
    supportsNativeTools: false,
    chat: async () => {
      throw new Error('not used');
    },
    async *stream(): AsyncIterable<StreamChunk> {
      for (const chunk of script) yield chunk;
    },
  };
}

function deps(script: StreamChunk[]): AgentRuntimeDeps {
  const provider = scriptedProvider(script);
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
    modelProviders: {
      resolveForRoute: () => undefined,
      resolveForAgent: () => provider,
    },
  } as unknown as AgentRuntimeDeps;
}

const SESSION = {
  id: 's1',
  userId: 'u1',
  agentId: 'a1',
  channel: 'cli',
  state: { metadata: {} },
} as unknown as Session;

const AGENT = {
  spec: {
    persona: 'default',
    skills: [],
    model: { provider: 'anthropic', model: 'm', maxTokens: 1024, temperature: 0 },
  },
} as unknown as AgentDefinition;

const INPUT = { content: 'hello' } as UserInput;

async function collect(runtime: DefaultAgentRuntime) {
  const out: Array<Record<string, unknown>> = [];
  for await (const event of runtime.stream(SESSION, AGENT, INPUT)) {
    out.push(event as unknown as Record<string, unknown>);
  }
  return out;
}

describe('mid-answer provider failure (issue #20)', () => {
  it('keeps the partial answer instead of discarding the turn', async () => {
    const runtime = new DefaultAgentRuntime(
      deps([
        { type: 'text_delta', delta: 'The first half of an ans' },
        { type: 'error', error: 'anthropic API call failed (HTTP 529)' },
      ]),
    );

    const events = await collect(runtime);

    // The generated text survives, followed by a visible notice.
    const text = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.delta as string)
      .join('');
    expect(text).toContain('The first half of an ans');
    expect(text).toContain('Response interrupted');
    expect(text).toContain('HTTP 529');

    // The turn ends cleanly rather than erroring the session out.
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('still errors when the failure lands before any output', async () => {
    // Nothing was generated, so there is nothing worth keeping.
    const runtime = new DefaultAgentRuntime(
      deps([{ type: 'error', error: 'anthropic API call failed (HTTP 401)' }]),
    );

    const events = await collect(runtime);

    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('run() no longer throws away a partial answer', async () => {
    const runtime = new DefaultAgentRuntime(
      deps([
        { type: 'text_delta', delta: 'partial' },
        { type: 'error', error: 'connection reset' },
      ]),
    );

    const result = await runtime.run(SESSION, AGENT, INPUT);

    expect(result.content).toContain('partial');
    expect(result.status).toBe('completed');
  });
});

describe('failover announcement (issue #21)', () => {
  it('surfaces a progress event naming both providers', async () => {
    const runtime = new DefaultAgentRuntime(
      deps([
        { type: 'failover', from: 'anthropic', to: 'openai', reason: 'HTTP 529' },
        { type: 'text_delta', delta: 'answer from the fallback' },
        { type: 'done' },
      ]),
    );

    const events = await collect(runtime);
    const phases = events.filter((e) => e.type === 'progress').map((e) => e.phase as string);

    expect(phases.some((p) => p.includes('openai') && p.includes('anthropic'))).toBe(true);
    // The notice is a progress event, never spliced into the answer text.
    const text = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.delta as string)
      .join('');
    expect(text).toBe('answer from the fallback');
  });
});
