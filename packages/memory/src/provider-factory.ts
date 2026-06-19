import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryEntryType,
  MemoryProvider,
  MemoryProviderHealth,
} from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';

/** Filesystem-based memory provider — default for local-first mode. */
export class FilesystemMemoryProvider implements MemoryProvider {
  readonly providerId = 'filesystem';

  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly sessionPrefix = 'memory/sessions',
    private readonly userPrefix = 'memory',
  ) {}

  private sessionKey(sessionId: string): string {
    return `${this.sessionPrefix}/${sessionId}.json`;
  }

  private userKey(userId: string): string {
    return `${this.userPrefix}/${userId}.json`;
  }

  async healthCheck(): Promise<MemoryProviderHealth> {
    return { ok: true, details: 'Filesystem memory provider active' };
  }

  async getContext(sessionId: string, _userId: string): Promise<MemoryContext> {
    const [shortTerm, longTerm] = await Promise.all([
      this.getMessages(sessionId),
      this.getBySession(sessionId),
    ]);
    return { shortTerm, longTerm, semantic: [] };
  }

  async storeConversation(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    await this.setMessages(sessionId, messages);
    for (const msg of messages.slice(-2)) {
      await this.store({
        sessionId,
        userId,
        type: 'conversation',
        content: JSON.stringify(msg),
      });
    }
  }

  async storeEntry(entry: MemoryEntry): Promise<void> {
    await this.store(entry);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const data = await this.storage.readJson<{ messages: ChatMessage[] }>(this.sessionKey(sessionId));
    return data?.messages ?? [];
  }

  async setMessages(sessionId: string, messages: ChatMessage[], _ttlSeconds?: number): Promise<void> {
    await this.storage.writeJson(this.sessionKey(sessionId), { messages });
  }

  async appendMessage(sessionId: string, message: ChatMessage, ttlSeconds?: number): Promise<void> {
    const messages = await this.getMessages(sessionId);
    messages.push(message);
    await this.setMessages(sessionId, messages, ttlSeconds);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.storage.delete(this.sessionKey(sessionId));
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
      if (items) entries.push(...items.filter((e) => e.sessionId === sessionId));
    }
    return entries.slice(-limit);
  }

  async getByUser(
    userId: string,
    type?: MemoryEntryType,
    limit = 50,
  ): Promise<MemoryEntry[]> {
    const items = (await this.storage.readJson<MemoryEntry[]>(this.userKey(userId))) ?? [];
    return items.filter((e) => !type || e.type === type).slice(-limit);
  }
}

function createStubProvider(id: string): MemoryProvider {
  const unavailable = (): never => {
    throw new Error(
      `Memory provider "${id}" is Level 2+ — use filesystem for local-first mode`,
    );
  };

  return {
    providerId: id,
    healthCheck: async () => ({ ok: false, details: `Provider "${id}" not configured` }),
    getContext: unavailable,
    storeConversation: unavailable,
    storeEntry: unavailable,
    getMessages: unavailable,
    setMessages: unavailable,
    appendMessage: unavailable,
    clearSession: unavailable,
    store: unavailable,
    getBySession: unavailable,
    getByUser: unavailable,
  };
}

export function createMemoryProvider(
  provider: string,
  storage: FilesystemStorageProvider,
): MemoryProvider {
  switch (provider) {
    case 'filesystem':
      return new FilesystemMemoryProvider(storage);
    case 'sqlite':
      return createStubProvider('sqlite');
    case 'postgresql':
    case 'redis':
      return createStubProvider(provider);
    case 'qdrant':
      return createStubProvider('qdrant');
    case 'honcho':
      return createStubProvider('honcho');
    default:
      return new FilesystemMemoryProvider(storage);
  }
}
