import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryEntryType,
  MemoryProvider,
  MemoryProviderHealth,
  SearchOptions,
} from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { createHonchoProvider, type HonchoConfig } from './providers/honcho/honcho-provider.js';
import { MemoryRecallIndex } from './recall-index.js';
import { openSqliteFtsRecall, type SqliteFtsRecall } from './providers/sqlite/sqlite-fts-recall.js';
import path from 'node:path';

export type SummarizerFn = (messages: ChatMessage[]) => Promise<string> | string;

export interface FilesystemMemoryOptions {
  enableFts?: boolean;
  /** Max messages retained in short-term store; 0 = unlimited (default). */
  maxShortTermMessages?: number;
  /** When true, overflow head is summarized and prepended; when false, head is dropped. */
  summarizeOnOverflow?: boolean;
  /** Optional LLM-backed summarizer; when absent, rule-based head/tail is used. */
  summarize?: SummarizerFn;
}

/** Filesystem-based memory provider — default for local-first mode. */
export class FilesystemMemoryProvider implements MemoryProvider {
  readonly providerId = 'filesystem';
  private readonly recallIndex: MemoryRecallIndex;
  private ftsRecall: SqliteFtsRecall | null = null;
  private ftsInit: Promise<void> | null = null;

  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly sessionPrefix = 'memory/sessions',
    private readonly userPrefix = 'memory',
    private readonly options: FilesystemMemoryOptions = {},
  ) {
    this.recallIndex = new MemoryRecallIndex(storage);
  }

  private ensureFts(): Promise<void> {
    if (!this.options.enableFts) return Promise.resolve();
    if (!this.ftsInit) {
      const dbPath = path.join(this.storage.rootPath, 'memory/recall.sqlite');
      this.ftsInit = openSqliteFtsRecall(dbPath).then((fts) => {
        this.ftsRecall = fts;
      });
    }
    return this.ftsInit;
  }

  private sessionKey(sessionId: string): string {
    return `${this.sessionPrefix}/${sessionId}.json`;
  }

  private userKey(userId: string): string {
    return `${this.userPrefix}/${userId}.json`;
  }

  async healthCheck(): Promise<MemoryProviderHealth> {
    await this.ensureFts();
    const fts = this.ftsRecall ? 'FTS5 recall enabled' : 'keyword recall index';
    return { ok: true, details: `Filesystem memory provider active (${fts})` };
  }

  async getContext(sessionId: string, userId: string): Promise<MemoryContext> {
    await this.ensureFts();
    const [shortTerm, longTerm] = await Promise.all([
      this.getMessages(sessionId),
      this.getBySession(sessionId),
    ]);
    const lastUser = [...shortTerm].reverse().find((m) => m.role === 'user');
    let recallEntries: MemoryEntry[] = [];
    if (lastUser) {
      const hits = this.ftsRecall
        ? this.ftsRecall.search(userId, lastUser.content, 5)
        : await this.recallIndex.recall(userId, lastUser.content, 3);
      recallEntries = hits.map((hit, i) => ({
        id: `recall-${i}`,
        sessionId: hit.sessionId,
        userId,
        type: hit.type,
        content: hit.content,
        createdAt: new Date(),
      }));
    }
    return { shortTerm, longTerm: [...recallEntries, ...longTerm], semantic: [] };
  }

  async storeConversation(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    const compressed = await this.applySlidingWindow(messages);
    await this.setMessages(sessionId, compressed);
    for (const msg of messages.slice(-2)) {
      await this.store({
        sessionId,
        userId,
        type: 'conversation',
        content: JSON.stringify(msg),
      });
    }
  }

  private async applySlidingWindow(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const max = this.options.maxShortTermMessages ?? 0;
    if (max <= 0 || messages.length <= max) return messages;

    const tailSize = Math.max(1, Math.floor(max / 2));
    const tail = messages.slice(-tailSize);
    const head = messages.slice(0, messages.length - tail.length);
    if (head.length === 0) return messages;

    const summarize = this.options.summarize;
    const shouldSummarize = this.options.summarizeOnOverflow !== false;

    if (!shouldSummarize) return tail;

    let summaryText: string;
    if (summarize) {
      try {
        summaryText = (await summarize(head)) || fallbackSummary(head);
      } catch {
        summaryText = fallbackSummary(head);
      }
    } else {
      summaryText = fallbackSummary(head);
    }

    // Role must be 'user': this summary is prepended to the window, and providers
    // reject a conversation whose first message is an assistant turn.
    const summaryMessage: ChatMessage = {
      role: 'user',
      content: `[Context summary — ${head.length} earlier messages compressed]\n${summaryText}`,
    };
    return [summaryMessage, ...tail];
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
    await this.recallIndex.indexEntry(stored);
    await this.ensureFts();
    this.ftsRecall?.index(stored);
    return stored;
  }

  async getBySession(sessionId: string, limit = 50): Promise<MemoryEntry[]> {
    const files = await this.storage.list('memory');
    const entries: MemoryEntry[] = [];
    for (const file of files.filter(
      (f) => f.endsWith('.json') && !f.includes('sessions/') && !f.endsWith('_recall-index.json'),
    )) {
      const items = await this.storage.readJson<MemoryEntry[]>(file);
      if (Array.isArray(items)) {
        entries.push(...items.filter((e) => e.sessionId === sessionId));
      }
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

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    await this.ensureFts();
    const userId = options?.userId ?? '';
    const limit = options?.limit ?? 10;
    const hits = this.ftsRecall
      ? this.ftsRecall.search(userId, query, limit)
      : await this.recallIndex.recall(userId, query, limit);
    return hits.map((hit, index) => ({
      id: `search-${index}`,
      sessionId: hit.sessionId,
      userId,
      type: hit.type,
      content: hit.content,
      createdAt: new Date(),
    }));
  }
}

function fallbackSummary(messages: ChatMessage[]): string {
  const userTopics = messages
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => m.content.slice(0, 120).replace(/\s+/g, ' ').trim());
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant')
    ?.content.slice(0, 280)
    .replace(/\s+/g, ' ')
    .trim();
  const parts: string[] = [];
  if (userTopics.length) parts.push(`Topics: ${userTopics.join(' | ')}`);
  if (lastAssistant) parts.push(`Last outcome: ${lastAssistant}`);
  return parts.join('\n') || `${messages.length} earlier messages`;
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
  honchoConfig?: HonchoConfig,
  memoryConfig?: {
    fts?: boolean;
    maxShortTermMessages?: number;
    summarizeOnOverflow?: boolean;
    summarize?: SummarizerFn;
  },
): MemoryProvider {
  const enableFts = memoryConfig?.fts === true || provider === 'sqlite';
  const opts: FilesystemMemoryOptions = {
    enableFts,
    maxShortTermMessages: memoryConfig?.maxShortTermMessages,
    summarizeOnOverflow: memoryConfig?.summarizeOnOverflow,
    summarize: memoryConfig?.summarize,
  };
  switch (provider) {
    case 'filesystem':
      return new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', opts);
    case 'sqlite':
      return new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', {
        ...opts,
        enableFts: true,
      });
    case 'honcho': {
      const config =
        honchoConfig ??
        (process.env.HONCHO_API_KEY
          ? {
              baseUrl: process.env.HONCHO_BASE_URL ?? 'https://api.honcho.dev',
              apiKey: process.env.HONCHO_API_KEY,
              workspaceId: process.env.HONCHO_WORKSPACE_ID,
            }
          : undefined);
      return createHonchoProvider(
        new FilesystemMemoryProvider(storage, 'memory/sessions', 'memory', opts),
        config,
      );
    }
    case 'postgresql':
    case 'redis':
      return createStubProvider(provider);
    case 'qdrant':
      return createStubProvider('qdrant');
    default:
      return new FilesystemMemoryProvider(storage);
  }
}
