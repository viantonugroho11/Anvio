import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryEntryType,
  MemoryProvider,
  MemoryProviderHealth,
} from '@anvio/core';

export interface HonchoConfig {
  baseUrl: string;
  apiKey: string;
  workspaceId?: string;
}

/** Honcho provider — filesystem delegate with optional Honcho API sync. */
export class HonchoMemoryProvider implements MemoryProvider {
  readonly providerId = 'honcho';

  constructor(
    private readonly delegate: MemoryProvider,
    private readonly config?: HonchoConfig,
  ) {}

  async healthCheck(): Promise<MemoryProviderHealth> {
    if (!this.config?.apiKey) {
      return { ok: true, details: 'Honcho delegate (filesystem) — API sync disabled' };
    }
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/health`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return { ok: res.ok, details: res.ok ? 'Honcho API reachable' : `Honcho HTTP ${res.status}` };
    } catch (error) {
      return {
        ok: true,
        details: `Honcho delegate active; API unreachable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async syncEntry(entry: MemoryEntry): Promise<void> {
    if (!this.config?.apiKey) return;
    try {
      await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/v1/memories`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: entry.userId,
          session_id: entry.sessionId,
          content: entry.content,
          type: entry.type,
        }),
      });
    } catch {
      // sync is best-effort; filesystem remains source of truth
    }
  }

  getContext(sessionId: string, userId: string): Promise<MemoryContext> {
    return this.delegate.getContext(sessionId, userId);
  }

  storeConversation(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    return this.delegate.storeConversation(sessionId, userId, messages);
  }

  storeEntry(entry: MemoryEntry): Promise<void> {
    return this.store(entry).then(() => undefined);
  }

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.delegate.getMessages(sessionId);
  }

  setMessages(sessionId: string, messages: ChatMessage[], ttlSeconds?: number): Promise<void> {
    return this.delegate.setMessages(sessionId, messages, ttlSeconds);
  }

  appendMessage(sessionId: string, message: ChatMessage, ttlSeconds?: number): Promise<void> {
    return this.delegate.appendMessage(sessionId, message, ttlSeconds);
  }

  clearSession(sessionId: string): Promise<void> {
    return this.delegate.clearSession(sessionId);
  }

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    const stored = await this.delegate.store(entry);
    await this.syncEntry(stored);
    return stored;
  }

  getBySession(sessionId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.delegate.getBySession(sessionId, limit);
  }

  getByUser(userId: string, type?: MemoryEntryType, limit?: number): Promise<MemoryEntry[]> {
    return this.delegate.getByUser(userId, type, limit);
  }
}

export function createHonchoProvider(
  delegate: MemoryProvider,
  config?: HonchoConfig,
): HonchoMemoryProvider {
  return new HonchoMemoryProvider(delegate, config);
}
