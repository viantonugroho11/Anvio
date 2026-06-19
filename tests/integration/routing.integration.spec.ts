import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ChatRequest, ChatResponse, ModelProvider } from '@anvio/core';
import { createModelRouter } from '@anvio/models';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { stringify as stringifyYaml } from 'yaml';

describe('Provider Routing & Fallback', () => {
  let tmpDir: string;
  let storage: FilesystemStorageProvider;
  let attempts = new Map<string, number>();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-routing-'));
    await Workspace.init(tmpDir);
    storage = new FilesystemStorageProvider(tmpDir);
    attempts = new Map();

    await storage.write(
      'providers/routing.yaml',
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'ProviderRouting',
        metadata: { name: 'default' },
        spec: {
          defaultStrategy: 'highest_quality',
          routes: {
            coding: {
              strategy: 'coding_optimized',
              primary: { provider: 'anthropic', model: 'claude-sonnet', pool: 'anthropic' },
              fallback: [{ provider: 'openai', model: 'gpt-4o' }],
            },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function mockProvider(id: string, failWith429 = false): ModelProvider {
    return {
      providerId: id,
      async chat(request: ChatRequest): Promise<ChatResponse> {
        const count = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, count);
        if (failWith429 && count === 1) {
          throw new Error('429 rate limit exceeded');
        }
        return {
          content: `response from ${id}`,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: request.model ?? id,
          finishReason: 'end_turn',
        };
      },
      async *stream() {
        yield { type: 'done' as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
    };
  }

  it('coding route selects anthropic primary', async () => {
    const router = createModelRouter({
      storage,
      providers: new Map([
        ['anthropic', mockProvider('anthropic')],
        ['openai', mockProvider('openai')],
      ]),
    });

    const result = await router.chat({
      messages: [{ role: 'user', content: 'implement auth middleware' }],
      routeOverride: 'coding',
    });

    expect(result.selectedProvider).toBe('anthropic');
    expect(result.failover).toBe(false);
  });

  it('429 on primary triggers fallback provider', async () => {
    const router = createModelRouter({
      storage,
      providers: new Map([
        ['anthropic', mockProvider('anthropic', true)],
        ['openai', mockProvider('openai')],
      ]),
    });

    const result = await router.chat({
      messages: [{ role: 'user', content: 'implement feature' }],
      routeOverride: 'coding',
    });

    expect(result.selectedProvider).toBe('openai');
    expect(result.failover).toBe(true);
  });

  it('agent override bypasses routing', async () => {
    const router = createModelRouter({
      storage,
      providers: new Map([['openai', mockProvider('openai')]]),
    });

    const result = await router.chat({
      messages: [{ role: 'user', content: 'hello' }],
      agent: {
        apiVersion: 'anvio.io/v1',
        kind: 'Agent',
        metadata: { name: 'test', version: '1.0.0' },
        spec: {
          description: 'test',
          persona: 'default',
          skills: [],
          tools: [],
          model: {
            provider: 'anthropic',
            model: 'claude',
            override: { provider: 'openai', model: 'gpt-4o' },
          } as never,
        },
      },
    });

    expect(result.selectedProvider).toBe('openai');
    expect(result.failover).toBe(false);
  });
});
