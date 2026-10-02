import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesystemStorageProvider } from '@anvio/storage';
import { createMemoryProvider, FilesystemMemoryProvider } from '../../provider-factory.js';
import { GbrainMemoryProvider, type GbrainClient } from './gbrain-provider.js';

describe('GbrainMemoryProvider', () => {
  let root: string;
  let delegate: FilesystemMemoryProvider;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'anvio-gbrain-'));
    delegate = new FilesystemMemoryProvider(new FilesystemStorageProvider(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function mockClient(handler: (name: string, args: Record<string, unknown>) => unknown): GbrainClient {
    return { callTool: vi.fn(async (name, args) => handler(name, args)) };
  }

  it('syncs fact entries via remember with provenance and kind', async () => {
    const client = mockClient(() => ({ id: '1', status: 'inserted', protocol_version: 1 }));
    const provider = new GbrainMemoryProvider(delegate, client);
    await provider.store({ sessionId: 's1', userId: 'u1', type: 'preference', content: 'likes tea' });

    expect(client.callTool).toHaveBeenCalledWith(
      'remember',
      expect.objectContaining({ fact: 'likes tea', kind: 'preference', provenance: expect.stringContaining('s1') }),
    );
    expect(await delegate.getBySession('s1')).toHaveLength(1);
  });

  it('does not sync raw conversation entries', async () => {
    const client = mockClient(() => ({}));
    const provider = new GbrainMemoryProvider(delegate, client);
    await provider.store({ sessionId: 's1', userId: 'u1', type: 'conversation', content: '{}' });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('adds recalled facts to semantic context for the last user message', async () => {
    const client = mockClient((name) =>
      name === 'recall'
        ? { facts: [{ fact_id: 'f9', fact: 'Acme uses Stripe', kind: 'fact', provenance: 'x' }], protocol_version: 1 }
        : {},
    );
    const provider = new GbrainMemoryProvider(delegate, client);
    await provider.appendMessage('s1', { role: 'user', content: 'what does Acme use?' });
    const ctx = await provider.getContext('s1', 'u1');

    expect(client.callTool).toHaveBeenCalledWith('recall', expect.objectContaining({ query: 'what does Acme use?' }));
    expect(ctx.semantic?.[0]).toMatchObject({ id: 'gbrain-f9', content: 'Acme uses Stripe', type: 'fact' });
  });

  it('degrades to delegate when gbrain errors or throws', async () => {
    const client = mockClient(() => {
      throw new Error('spawn gbrain ENOENT');
    });
    const provider = new GbrainMemoryProvider(delegate, client);
    await provider.appendMessage('s1', { role: 'user', content: 'hi' });
    await expect(provider.getContext('s1', 'u1')).resolves.toMatchObject({ shortTerm: [{ content: 'hi' }] });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.details).toContain('ENOENT');
  });

  it('treats gbrain error envelopes as failures', async () => {
    const client = mockClient(() => ({ error: 'not_found', message: 'no fact', protocol_version: 1 }));
    const provider = new GbrainMemoryProvider(delegate, client);
    expect(await provider.forget('gbrain-f1')).toBe(false);
    expect(client.callTool).toHaveBeenCalledWith('forget', { id: 'f1' });
  });

  it('is selectable from the factory and works without a client', async () => {
    const provider = createMemoryProvider('gbrain', new FilesystemStorageProvider(root));
    expect(provider.providerId).toBe('gbrain');
    expect((await provider.healthCheck()).details).toContain('no gbrain client');
  });
});
