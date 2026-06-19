import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryStore,
  ShortTermMemoryPort,
  LongTermMemoryPort,
} from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';

/** Filesystem-based memory — default for local-first mode. */
export class FilesystemShortTermMemory implements ShortTermMemoryPort {
  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly prefix = 'memory/sessions',
  ) {}

  private key(sessionId: string): string {
    return `${this.prefix}/${sessionId}.json`;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const data = await this.storage.readJson<{ messages: ChatMessage[] }>(this.key(sessionId));
    return data?.messages ?? [];
  }

  async setMessages(sessionId: string, messages: ChatMessage[], _ttlSeconds?: number): Promise<void> {
    await this.storage.writeJson(this.key(sessionId), { messages });
  }

  async appendMessage(sessionId: string, message: ChatMessage, ttlSeconds?: number): Promise<void> {
    const messages = await this.getMessages(sessionId);
    messages.push(message);
    await this.setMessages(sessionId, messages, ttlSeconds);
  }

  async clear(sessionId: string): Promise<void> {
    await this.storage.delete(this.key(sessionId));
  }
}

export class FilesystemLongTermMemory implements LongTermMemoryPort {
  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly prefix = 'memory',
  ) {}

  private userKey(userId: string): string {
    return `${this.prefix}/${userId}.json`;
  }

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    const key = this.userKey(entry.userId);
    const existing = (await this.storage.readJson<MemoryEntry[]>(key)) ?? [];
    const stored: MemoryEntry = {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      createdAt: new Date(),
    };
    existing.push(stored);
    await this.storage.writeJson(key, existing);
    return stored;
  }

  async getBySession(sessionId: string, limit = 50): Promise<MemoryEntry[]> {
    const files = await this.storage.list('memory');
    const entries: MemoryEntry[] = [];
    for (const file of files.filter((f) => f.endsWith('.json') && !f.includes('sessions/'))) {
      const items = await this.storage.readJson<MemoryEntry[]>(file);
      if (items) {
        entries.push(...items.filter((e) => e.sessionId === sessionId));
      }
    }
    return entries.slice(-limit);
  }

  async getByUser(
    userId: string,
    type?: MemoryEntry['type'],
    limit = 50,
  ): Promise<MemoryEntry[]> {
    const items = (await this.storage.readJson<MemoryEntry[]>(this.userKey(userId))) ?? [];
    return items.filter((e) => !type || e.type === type).slice(-limit);
  }
}

export class FilesystemMemoryStore implements MemoryStore {
  private readonly shortTerm: FilesystemShortTermMemory;
  private readonly longTerm: FilesystemLongTermMemory;

  constructor(storage: FilesystemStorageProvider) {
    this.shortTerm = new FilesystemShortTermMemory(storage);
    this.longTerm = new FilesystemLongTermMemory(storage);
  }

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
    await this.shortTerm.setMessages(sessionId, messages);
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

export function createMemoryStore(
  provider: string,
  storage: FilesystemStorageProvider,
): MemoryStore {
  switch (provider) {
    case 'filesystem':
      return new FilesystemMemoryStore(storage);
    case 'redis':
    case 'postgresql':
    case 'qdrant':
    case 'sqlite':
      throw new Error(
        `Memory provider "${provider}" is Level 2+ — use filesystem for local-first mode`,
      );
    default:
      return new FilesystemMemoryStore(storage);
  }
}
