import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelProvider } from './provider-factory.js';
import { OPENAI_COMPATIBLE_PROVIDER_SPECS } from './provider-catalog.js';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const COMPLETION = {
  model: 'm',
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function lastCall(): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

const TOOL = {
  name: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
};

describe('catalog spec fields reach the adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValue(jsonResponse(COMPLETION));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_API_KEY;
  });

  it('omits tools for perplexity, whose sonar models reject them', async () => {
    const provider = createModelProvider({ provider: 'perplexity', apiKey: 'k' });
    expect(provider.supportsNativeTools).toBe(false);

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [TOOL] });

    expect(lastCall().body.tools).toBeUndefined();
  });

  it('still sends tools for a provider that supports them', async () => {
    const provider = createModelProvider({ provider: 'groq', apiKey: 'k' });
    expect(provider.supportsNativeTools).toBe(true);

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [TOOL] });

    expect(lastCall().body.tools).toHaveLength(1);
  });

  it('clamps an explicitly requested max_tokens down to the moonshot ceiling', async () => {
    // The clamp has to bind against a caller-supplied value: agent frontmatter
    // always populates maxTokens, so a default would never take effect.
    const provider = createModelProvider({ provider: 'moonshot', apiKey: 'k' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8192 });

    expect(lastCall().body.max_tokens).toBe(4096);
  });

  it('leaves max_tokens alone for a provider with no ceiling', async () => {
    const provider = createModelProvider({ provider: 'openai', apiKey: 'k' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8192 });

    expect(lastCall().body.max_tokens).toBe(8192);
  });

  it('points cohere at its OpenAI compatibility endpoint', async () => {
    expect(OPENAI_COMPATIBLE_PROVIDER_SPECS.cohere.baseUrl).toContain('/compatibility/v1');

    const provider = createModelProvider({ provider: 'cohere', apiKey: 'k' });
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(lastCall().url).toBe('https://api.cohere.ai/compatibility/v1/chat/completions');
  });

  it('reads OLLAMA_API_KEY even though the key is optional', async () => {
    process.env.OLLAMA_API_KEY = 'ollama-secret';
    const provider = createModelProvider({ provider: 'ollama' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ollama-secret');
  });

  it('still registers ollama with no key at all', async () => {
    const provider = createModelProvider({ provider: 'ollama' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('lets a caller override native tool support per instance', () => {
    const provider = createModelProvider({
      provider: 'ollama',
      supportsNativeTools: false,
    });

    expect(provider.supportsNativeTools).toBe(false);
  });
});
