import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryStore,
  ShortTermMemoryPort,
  LongTermMemoryPort,
} from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { createMemoryProvider } from './provider-factory.js';
import type { MemoryProvider } from '@anvio/core';

export class CompositeMemoryStore implements MemoryStore {
  constructor(
    private readonly shortTerm: ShortTermMemoryPort,
    private readonly longTerm: LongTermMemoryPort,
    private readonly defaultTtl = 3600,
  ) {}

  async getContext(sessionId: string, _userId: string): Promise<MemoryContext> {
    const [shortTerm, longTerm] = await Promise.all([
      this.shortTerm.getMessages(sessionId),
      this.longTerm.getBySession(sessionId),
    ]);
    return { shortTerm, longTerm, semantic: [] };
  }

  async storeConversation(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    await this.shortTerm.setMessages(sessionId, messages, this.defaultTtl);
    for (const msg of messages.slice(-2)) {
      await this.longTerm.store({
        sessionId,
        userId,
        type: 'conversation',
        content: JSON.stringify(msg),
      });
    }
  }

  async storeEntry(entry: MemoryEntry): Promise<void> {
    await this.longTerm.store(entry);
  }
}

/** @deprecated Use FilesystemMemoryProvider via createMemoryProvider */
export {
  FilesystemShortTermMemory,
  FilesystemLongTermMemory,
  FilesystemMemoryStore,
} from './filesystem-memory.js';

export function createMemoryStore(
  provider: string,
  storage: FilesystemStorageProvider,
): MemoryStore {
  return createMemoryProvider(provider, storage);
}

export function createMemoryProviderFromConfig(
  provider: string,
  storage: FilesystemStorageProvider,
): MemoryProvider {
  return createMemoryProvider(provider, storage);
}

export * from './provider-factory.js';
export * from './filesystem-memory.js';
