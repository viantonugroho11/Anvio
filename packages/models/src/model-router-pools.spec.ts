import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AcquiredCredential,
  ChatRequest,
  CredentialPoolManager,
  ModelProvider,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import { ModelRouter } from './model-router.js';
import { ModelProviderRegistry } from './model-provider-registry.js';

const POOLED_ROUTING = `apiVersion: anvio.io/v1
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
        pool: anthropic
      fallback: []
`;

const UNPOOLED_ROUTING = POOLED_ROUTING.replace('        pool: anthropic\n', '');

function storageWith(routing: string | null) {
  return {
    read: async () => routing,
  } as unknown as import('@anvio/storage').FilesystemStorageProvider;
}

function registeredProvider(): ModelProvider {
  return {
    providerId: 'anthropic',
    supportsNativeTools: true,
    chat: async () => ({
      content: 'from the registered provider',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'm1',
      finishReason: 'end_turn',
    }),
    async *stream() {
      yield { type: 'done' as const };
    },
  };
}

/** Pool that hands out `keys` in order, recording every acquire. */
function poolYielding(keys: string[]): CredentialPoolManager & { acquires: number } {
  let index = 0;
  const manager = {
    acquires: 0,
    async acquire(poolSlug: string): Promise<AcquiredCredential> {
      const credentialId = keys[index % keys.length]!;
      index += 1;
      manager.acquires += 1;
      return { poolSlug, credentialId, value: `sk-${credentialId}`, provider: 'anthropic' };
    },
  } as unknown as CredentialPoolManager & { acquires: number };
  return manager;
}

const ASK = { messages: [{ role: 'user', content: 'hi' }] } as ChatRequest;

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

/** Every `x-api-key` the Anthropic SDK actually put on the wire. */
function sentKeys(): string[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const headers = (init as RequestInit).headers as Record<string, string> | Headers;
    return headers instanceof Headers
      ? (headers.get('x-api-key') ?? '')
      : (headers['x-api-key'] ?? headers['X-Api-Key'] ?? '');
  });
}

function anthropicReply() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'm1',
      content: [{ type: 'text', text: 'from the pooled credential' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    text: async () => '',
  } as unknown as Response;
}

describe('credential pools on the request path (issue #22)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(anthropicReply());
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the pooled credential, not the registered provider', async () => {
    // The bug: acquire() ran — advancing rotation counters and usage tracking —
    // and then the registry's provider was returned, so the request went out
    // under the env-var key and no pooled credential was ever used.
    const registered = registeredProvider();
    const pool = poolYielding(['key-a']);
    const router = new ModelRouter({
      storage: storageWith(POOLED_ROUTING),
      providers: new Map([['anthropic', registered]]),
      credentialPools: pool,
    });

    const result = await router.chat(ASK);

    expect(pool.acquires).toBe(1);
    expect(sentKeys()).toEqual(['sk-key-a']);
    expect(result.content).toBe('from the pooled credential');
  });

  it('rotates the key on the wire as the pool rotates', async () => {
    const pool = poolYielding(['key-a', 'key-b']);
    const router = new ModelRouter({
      storage: storageWith(POOLED_ROUTING),
      providers: new Map(),
      credentialPools: pool,
    });

    await router.chat(ASK);
    await router.chat(ASK);
    await router.chat(ASK);

    // Acquired every call so rotation stays live; clients are cached per credential.
    expect(pool.acquires).toBe(3);
    expect(sentKeys()).toEqual(['sk-key-a', 'sk-key-b', 'sk-key-a']);
  });

  it('falls back to the registered provider when the route names no pool', async () => {
    const registered = registeredProvider();
    const pool = poolYielding(['key-a']);
    const router = new ModelRouter({
      storage: storageWith(UNPOOLED_ROUTING),
      providers: new Map([['anthropic', registered]]),
      credentialPools: pool,
    });

    const result = await router.chat(ASK);

    expect(pool.acquires).toBe(0);
    expect(result.content).toBe('from the registered provider');
  });

  it('fails clearly when a target has neither a pool nor a registration', async () => {
    const router = new ModelRouter({
      storage: storageWith(UNPOOLED_ROUTING),
      providers: new Map(),
    });

    await expect(router.chat(ASK)).rejects.toThrow(AnvioError);
    await expect(router.chat(ASK)).rejects.toThrow(/neither a registered provider/);
  });
});

describe('ModelProviderRegistry runtime mutation', () => {
  it('upserts a provider so a key written at runtime takes effect', () => {
    // The map was built once at boot, so a credential added later could not reach
    // the running process without a restart.
    const registry = new ModelProviderRegistry(new Map());
    expect(registry.getOptional('anthropic')).toBeUndefined();

    const provider = registeredProvider();
    registry.upsert('anthropic', provider);

    expect(registry.get('anthropic')).toBe(provider);
    expect(registry.listConfigured()).toContain('anthropic');
  });

  it('replaces an existing provider in place', () => {
    const first = registeredProvider();
    const second = registeredProvider();
    const registry = new ModelProviderRegistry(new Map([['anthropic', first]]));

    registry.upsert('anthropic', second);

    expect(registry.get('anthropic')).toBe(second);
    expect(registry.listConfigured()).toHaveLength(1);
  });

  it('removes a provider whose credential was revoked', () => {
    const registry = new ModelProviderRegistry(new Map([['anthropic', registeredProvider()]]));

    expect(registry.remove('anthropic')).toBe(true);
    expect(registry.remove('anthropic')).toBe(false);
    expect(registry.getOptional('anthropic')).toBeUndefined();
  });
});
