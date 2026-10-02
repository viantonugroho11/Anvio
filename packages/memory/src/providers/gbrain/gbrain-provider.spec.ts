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

describe('GbrainMemoryProvider episodic timeline (ADR 0035)', () => {
  let root: string;
  let delegate: FilesystemMemoryProvider;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'anvio-gbrain-ep-'));
    delegate = new FilesystemMemoryProvider(new FilesystemStorageProvider(root));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function brain() {
    const pages = new Set<string>();
    const entries: Array<Record<string, unknown>> = [];
    const client: GbrainClient = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'get_page') {
          return pages.has(String(args.slug)) ? { slug: args.slug } : { error: 'not_found', message: 'no page' };
        }
        if (name === 'put_page') {
          pages.add(String(args.slug));
          return { ok: true };
        }
        if (name === 'add_timeline_entry') {
          if (!entries.some((e) => e.request_id === args.request_id)) entries.push(args);
          return { ok: true };
        }
        return {};
      }),
    };
    return { client, pages, entries };
  }

  it('creates the session page once and appends only new user/assistant turns', async () => {
    const { client, pages, entries } = brain();
    const provider = new GbrainMemoryProvider(delegate, client, { episodic: true });
    await provider.storeConversation('S1', 'u1', [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'deploy plan?' },
      { role: 'assistant', content: 'Use blue/green.\nDetails follow.' },
    ]);
    await provider.storeConversation('S1', 'u1', [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'deploy plan?' },
      { role: 'assistant', content: 'Use blue/green.\nDetails follow.' },
      { role: 'user', content: 'ok go' },
    ]);

    expect([...pages]).toEqual(['anvio/sessions/s1']);
    expect(vi.mocked(client.callTool).mock.calls.filter(([n]) => n === 'put_page')).toHaveLength(1);
    expect(entries.map((e) => e.summary)).toEqual(['user: deploy plan?', 'assistant: Use blue/green.', 'user: ok go']);
    expect(entries[1]).toMatchObject({ detail: 'Use blue/green.\nDetails follow.', request_id: 'anvio-S1-2' });
  });

  it('never overwrites an existing page and stays off unless episodic', async () => {
    const { client, pages } = brain();
    pages.add('anvio/sessions/s2');
    await new GbrainMemoryProvider(delegate, client, { episodic: true }).storeConversation('S2', 'u', [
      { role: 'user', content: 'hi' },
    ]);
    expect(vi.mocked(client.callTool).mock.calls.some(([n]) => n === 'put_page')).toBe(false);

    const off = brain();
    await new GbrainMemoryProvider(delegate, off.client).storeConversation('S3', 'u', [{ role: 'user', content: 'hi' }]);
    expect(off.client.callTool).not.toHaveBeenCalled();
  });
});

describe('GbrainMemoryProvider.consolidateSession', () => {
  it('summarizes the timeline and remembers it with provenance', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const client: GbrainClient = {
      callTool: async (name, args) => {
        calls.push([name, args]);
        if (name === 'get_timeline') {
          return [
            { summary: 'user: deploy plan?', detail: null },
            { summary: 'assistant: Use blue/green.', detail: 'Use blue/green.\nDetails.' },
            { summary: 'meeting moved', detail: null },
          ];
        }
        return { id: '1', status: 'inserted' };
      },
    };
    const provider = new GbrainMemoryProvider({} as never, client);
    const summarize = vi.fn(async () => 'Agreed on blue/green deploys.');
    expect(await provider.consolidateSession('S1', summarize)).toBe('Agreed on blue/green deploys.');
    expect(summarize).toHaveBeenCalledWith([
      { role: 'user', content: 'deploy plan?' },
      { role: 'assistant', content: 'Use blue/green.\nDetails.' },
    ]);
    expect(calls.at(-1)).toEqual([
      'remember',
      {
        fact: 'Agreed on blue/green deploys.',
        provenance: 'anvio session timeline anvio/sessions/s1',
        kind: 'event',
        request_id: 'anvio-consolidate-S1-2',
      },
    ]);
  });

  it('returns null for an empty timeline without calling the summarizer', async () => {
    const summarize = vi.fn(async () => 'x');
    const provider = new GbrainMemoryProvider({} as never, { callTool: async () => [] });
    expect(await provider.consolidateSession('S1', summarize)).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });
});
