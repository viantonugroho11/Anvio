import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChatMessage } from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { FilesystemMemoryProvider } from './provider-factory.js';

function mkMsg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

function makeHistory(n: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(mkMsg(i % 2 === 0 ? 'user' : 'assistant', `msg-${i}`));
  }
  return out;
}

describe('FilesystemMemoryProvider sliding-window', () => {
  let tmpDir: string;
  let storage: FilesystemStorageProvider;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mem-'));
    storage = new FilesystemStorageProvider(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('no compression when maxShortTermMessages is 0 (default)', async () => {
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 0,
    });
    const history = makeHistory(100);
    await provider.storeConversation('s1', 'u1', history);
    const stored = await provider.getMessages('s1');
    expect(stored.length).toBe(100);
  });

  it('no compression when history length <= max', async () => {
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 40,
    });
    const history = makeHistory(40);
    await provider.storeConversation('s1', 'u1', history);
    const stored = await provider.getMessages('s1');
    expect(stored.length).toBe(40);
  });

  it('compresses to summary + tail when overflow with summarizer', async () => {
    const summarize = vi.fn().mockResolvedValue('compressed summary');
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 10,
      summarizeOnOverflow: true,
      summarize,
    });
    const history = makeHistory(30);
    await provider.storeConversation('s1', 'u1', history);
    const stored = await provider.getMessages('s1');

    expect(stored.length).toBe(6);
    // The summary leads the window, so it must be a user turn — providers reject
    // a conversation whose first message is an assistant turn.
    expect(stored[0].role).toBe('user');
    expect(stored[0].content).toContain('Context summary');
    expect(stored[0].content).toContain('compressed summary');
    expect(stored[stored.length - 1].content).toBe('msg-29');
    expect(summarize).toHaveBeenCalledOnce();
    expect(summarize.mock.calls[0][0].length).toBe(25);
  });

  it('falls back to rule-based summary when summarizer returns empty', async () => {
    const summarize = vi.fn().mockResolvedValue('');
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 10,
      summarizeOnOverflow: true,
      summarize,
    });
    const history = makeHistory(30);
    await provider.storeConversation('s1', 'u1', history);
    const stored = await provider.getMessages('s1');
    expect(stored[0].content).toContain('Context summary');
    expect(stored[0].content.length).toBeGreaterThan('[Context summary — 25 earlier messages compressed]\n'.length);
  });

  it('falls back to rule-based summary when summarizer throws', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('llm down'));
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 10,
      summarizeOnOverflow: true,
      summarize,
    });
    await provider.storeConversation('s1', 'u1', makeHistory(30));
    const stored = await provider.getMessages('s1');
    expect(stored[0].content).toContain('Context summary');
  });

  it('drops head without summary when summarizeOnOverflow is false', async () => {
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 10,
      summarizeOnOverflow: false,
    });
    const history = makeHistory(30);
    await provider.storeConversation('s1', 'u1', history);
    const stored = await provider.getMessages('s1');
    expect(stored.length).toBe(5);
    expect(stored[0].content).toBe('msg-25');
    expect(stored[stored.length - 1].content).toBe('msg-29');
  });

  it('uses fallback summary when no summarizer injected', async () => {
    const provider = new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
      maxShortTermMessages: 10,
    });
    await provider.storeConversation('s1', 'u1', makeHistory(30));
    const stored = await provider.getMessages('s1');
    expect(stored.length).toBe(6);
    expect(stored[0].content).toContain('Context summary');
  });
});
