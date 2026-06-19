import { describe, it, expect } from 'vitest';
import {
  createModelProvider,
  createModelProviderRegistry,
} from './provider-factory.js';
import {
  allKnownProviderIds,
  MODEL_PROVIDER_IDS,
  OPENAI_COMPATIBLE_PROVIDER_SPECS,
} from './provider-catalog.js';
import { createModelProviderRegistryInstance } from './model-provider-registry.js';

describe('Model provider factory', () => {
  it('creates anthropic provider with api key', () => {
    const provider = createModelProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });
    expect(provider.providerId).toBe('anthropic');
  });

  it('creates openai-compatible providers including deepseek', () => {
    const openai = createModelProvider({ provider: 'openai', apiKey: 'test-key' });
    const deepseek = createModelProvider({ provider: 'deepseek', apiKey: 'test-key' });
    const groq = createModelProvider({ provider: 'groq', apiKey: 'test-key' });
    const ollama = createModelProvider({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    });

    expect(openai.providerId).toBe('openai');
    expect(deepseek.providerId).toBe('deepseek');
    expect(groq.providerId).toBe('groq');
    expect(ollama.providerId).toBe('ollama');
  });

  it('creates gemini and custom providers', () => {
    const gemini = createModelProvider({ provider: 'gemini', apiKey: 'test-key' });
    const custom = createModelProvider({
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'my-model',
    });

    expect(gemini.providerId).toBe('gemini');
    expect(custom.providerId).toBe('custom');
  });

  it('registers all providers when api keys are supplied', () => {
    const apiKeys: Record<string, string> = {};
    for (const id of Object.keys(OPENAI_COMPATIBLE_PROVIDER_SPECS)) {
      if (id !== 'ollama') apiKeys[id] = 'key';
    }

    const map = createModelProviderRegistry({
      anthropicApiKey: 'a',
      apiKeys: { ...apiKeys, gemini: 'c' },
      ollamaBaseUrl: 'http://127.0.0.1:11434',
    });

    expect(map.has('anthropic')).toBe(true);
    expect(map.has('gemini')).toBe(true);
    expect(map.has('deepseek')).toBe(true);
    expect(map.has('groq')).toBe(true);
    expect(map.has('ollama')).toBe(true);
  });

  it('lists all known provider ids including deepseek', () => {
    expect(allKnownProviderIds()).toContain('deepseek');
    expect(MODEL_PROVIDER_IDS).toContain('custom');
  });

  it('resolves provider for agent definition', () => {
    const map = createModelProviderRegistry({ apiKeys: { openai: 'test-key' } });
    const registry = createModelProviderRegistryInstance(map);
    const agent = {
      apiVersion: 'anvio.io/v1' as const,
      kind: 'Agent' as const,
      metadata: { name: 'test', version: '1.0.0' },
      spec: {
        description: 'test',
        persona: 'architect',
        skills: [],
        tools: [],
        model: { provider: 'openai' as const, model: 'gpt-4o', maxTokens: 8192 },
        memory: {
          shortTerm: { enabled: true, ttlSeconds: 3600 },
          longTerm: { enabled: true },
          semantic: { enabled: false },
        },
        orchestration: { pattern: 'single' as const, delegates: [] },
        approvals: { requiredFor: ['destructive' as const] },
        workspace: { isolatedWorktree: false },
      },
    };
    expect(registry.resolveForAgent(agent).providerId).toBe('openai');
  });
});
