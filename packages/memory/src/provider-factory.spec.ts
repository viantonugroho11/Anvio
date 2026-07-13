import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChatMessage } from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { FilesystemMemoryProvider } from './provider-factory.js';

function turns(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${i}`,
  }));
}

async function withProvider(
  opts: ConstructorParameters<typeof FilesystemMemoryProvider>[3],
  fn: (p: FilesystemMemoryProvider) => Promise<void>,
) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mem-'));
  try {
    await fn(new FilesystemMemoryProvider(new FilesystemStorageProvider(tmp), undefined, undefined, opts));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

describe('FilesystemMemoryProvider sliding window (ADR-0010 L1)', () => {
  it('stores full history when window disabled (default)', async () => {
    await withProvider({}, async (p) => {
      await p.storeConversation('s1', 'u1', turns(60));
      expect(await p.getMessages('s1')).toHaveLength(60);
    });
  });

  it('compresses head into one summary message when over the window', async () => {
    await withProvider({ maxShortTermMessages: 40 }, async (p) => {
      await p.storeConversation('s1', 'u1', turns(60));
      const stored = await p.getMessages('s1');
      // 1 summary + tail of 20 (window/2)
      expect(stored).toHaveLength(21);
      expect(stored[0].content).toContain('[Context summary — 40 earlier messages compressed]');
      expect(stored.at(-1)?.content).toBe('message 59');
    });
  });

  it('uses injected summarizer for the compressed head', async () => {
    await withProvider(
      {
        maxShortTermMessages: 10,
        summarizeHead: async (msgs) => `LLM summary of ${msgs.length} messages`,
      },
      async (p) => {
        await p.storeConversation('s1', 'u1', turns(20));
        const stored = await p.getMessages('s1');
        expect(stored[0].content).toContain('LLM summary of 15 messages');
      },
    );
  });

  it('leaves history under the window untouched', async () => {
    await withProvider({ maxShortTermMessages: 40 }, async (p) => {
      await p.storeConversation('s1', 'u1', turns(40));
      expect(await p.getMessages('s1')).toHaveLength(40);
    });
  });
});
