import { describe, expect, it } from 'vitest';
import type { ChatRequest, ModelProvider, StreamChunk } from '@anvio/core';
import { ModelRouter } from './model-router.js';
import { ProviderCircuitBreaker } from './circuit-breaker.js';

const ROUTING_YAML = `apiVersion: anvio.io/v1
kind: ProviderRouting
metadata:
  name: test
spec:
  defaultStrategy: highest_quality
  routes:
    coding:
      strategy: coding_optimized
      primary:
        provider: anthropic
        model: m1
      fallback:
        - provider: openai
          model: m2
`;

function storageWith(routing: string | null) {
  return {
    read: async () => routing,
  } as unknown as import('@anvio/storage').FilesystemStorageProvider;
}

/** Provider that replays a fixed chunk script, recording that it was called. */
function scriptedProvider(
  providerId: string,
  script: StreamChunk[],
  calls: string[],
): ModelProvider {
  return {
    providerId,
    supportsNativeTools: true,
    chat: async () => {
      throw new Error('not used');
    },
    async *stream(): AsyncIterable<StreamChunk> {
      calls.push(providerId);
      for (const chunk of script) yield chunk;
    },
  };
}

const ASK = { messages: [{ role: 'user', content: 'hi' }] } as ChatRequest;

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('ModelRouter.stream failover', () => {
  it('fails over silently when the first target dies before emitting anything', async () => {
    const calls: string[] = [];
    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider('anthropic', [{ type: 'error', error: '529', retryable: true }], calls),
        ],
        [
          'openai',
          scriptedProvider(
            'openai',
            [{ type: 'text_delta', delta: 'recovered' }, { type: 'done' }],
            calls,
          ),
        ],
      ]),
    });

    const chunks = await collect(router.stream(ASK));

    expect(calls).toEqual(['anthropic', 'openai']);
    // The consumer never sees the first target's failure.
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'recovered' });
  });

  it('does NOT fail over once content has been emitted', async () => {
    // The committed-output invariant: emitted text cannot be retracted, so a
    // mid-stream failure is surfaced rather than silently replaced.
    const calls: string[] = [];
    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider(
            'anthropic',
            [
              { type: 'text_delta', delta: 'half an answ' },
              { type: 'error', error: 'connection dropped', retryable: true },
            ],
            calls,
          ),
        ],
        ['openai', scriptedProvider('openai', [{ type: 'text_delta', delta: 'other' }], calls)],
      ]),
    });

    const chunks = await collect(router.stream(ASK));

    expect(calls).toEqual(['anthropic']);
    expect(chunks).toEqual([
      { type: 'text_delta', delta: 'half an answ' },
      { type: 'error', error: 'connection dropped', retryable: true },
    ]);
  });

  it('does not fail over on a terminal error', async () => {
    const calls: string[] = [];
    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider(
            'anthropic',
            [{ type: 'error', error: 'bad key', retryable: false }],
            calls,
          ),
        ],
        ['openai', scriptedProvider('openai', [{ type: 'text_delta', delta: 'x' }], calls)],
      ]),
    });

    const chunks = await collect(router.stream(ASK));

    expect(calls).toEqual(['anthropic']);
    expect(chunks).toEqual([{ type: 'error', error: 'bad key', retryable: false }]);
  });

  it('replays every chunk consumed while priming', async () => {
    const calls: string[] = [];
    const script: StreamChunk[] = [
      { type: 'text_delta', delta: 'a' },
      { type: 'text_delta', delta: 'b' },
      { type: 'tool_use', toolCall: { id: 't1', name: 'search', arguments: {} } },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    ];
    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([['anthropic', scriptedProvider('anthropic', script, calls)]]),
    });

    expect(await collect(router.stream(ASK))).toEqual(script);
  });

  it('skips a target whose circuit is open', async () => {
    const calls: string[] = [];
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure('anthropic');

    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider('anthropic', [{ type: 'text_delta', delta: 'nope' }], calls),
        ],
        ['openai', scriptedProvider('openai', [{ type: 'text_delta', delta: 'yes' }], calls)],
      ]),
      breaker,
    });

    const chunks = await collect(router.stream(ASK));

    expect(calls).toEqual(['openai']);
    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'yes' });
  });

  it('opens the circuit after a retryable stream failure', async () => {
    const calls: string[] = [];
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
    const router = new ModelRouter({
      storage: storageWith(ROUTING_YAML),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider('anthropic', [{ type: 'error', error: '529', retryable: true }], calls),
        ],
        ['openai', scriptedProvider('openai', [{ type: 'text_delta', delta: 'ok' }], calls)],
      ]),
      breaker,
    });

    expect(breaker.canAttempt('anthropic')).toBe(true);
    await collect(router.stream(ASK));
    expect(breaker.canAttempt('anthropic')).toBe(false);
  });
});

describe('ModelRouter.stream without routing.yaml', () => {
  it('uses the caller-resolved provider, not an arbitrary first entry', async () => {
    // Preserves pre-router behaviour: the agent's own provider is honoured.
    const calls: string[] = [];
    const agentProvider = scriptedProvider(
      'gemini',
      [{ type: 'text_delta', delta: 'from gemini' }],
      calls,
    );
    const router = new ModelRouter({
      storage: storageWith(null),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider('anthropic', [{ type: 'text_delta', delta: 'wrong' }], calls),
        ],
        ['gemini', agentProvider],
      ]),
    });

    const chunks = await collect(router.stream(ASK, agentProvider));

    expect(calls).toEqual(['gemini']);
    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'from gemini' });
  });

  it('falls back to the first registered provider when no direct one is given', async () => {
    const calls: string[] = [];
    const router = new ModelRouter({
      storage: storageWith(null),
      providers: new Map([
        [
          'anthropic',
          scriptedProvider('anthropic', [{ type: 'text_delta', delta: 'first' }], calls),
        ],
      ]),
    });

    await collect(router.stream(ASK));

    expect(calls).toEqual(['anthropic']);
  });
});
