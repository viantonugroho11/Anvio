import type {
  ChatMessage,
  MemoryContext,
  MemoryEntry,
  MemoryEntryType,
  MemoryProvider,
  MemoryProviderHealth,
  SearchOptions,
} from '@anvio/core';

/**
 * Minimal MCP tool-call surface. Injected by the composition root (platform wires
 * `McpStdioClient` from @anvio/integrations) so this package stays dependency-free.
 */
export interface GbrainClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

export interface GbrainConfig {
  /** Max facts pulled into getContext() from `recall`. */
  recallLimit?: number;
  /** Token budget passed to `recall` (server-side packing). */
  budgetTokens?: number;
}

interface GbrainFact {
  fact_id?: string;
  id?: number | string;
  fact?: string;
  kind?: string;
  provenance?: string;
}

interface GbrainRecallResponse {
  facts?: GbrainFact[];
  results?: Array<{ slug?: string; title?: string; chunk?: string }>;
  error?: string;
  message?: string;
}

interface GbrainError {
  error: string;
  message?: string;
}

function isGbrainError(value: unknown): value is GbrainError {
  return typeof value === 'object' && value !== null && typeof (value as GbrainError).error === 'string';
}

/** gbrain `remember.kind` for each Anvio entry type; `conversation` is never synced. */
const KIND_BY_TYPE: Partial<Record<MemoryEntryType, string>> = {
  fact: 'fact',
  preference: 'preference',
  summary: 'event',
};

const TYPE_BY_KIND: Record<string, MemoryEntryType> = {
  preference: 'preference',
  event: 'summary',
};

/**
 * gbrain provider — filesystem delegate for sessions/short-term, with durable facts
 * synced to a gbrain brain over the MEMORY_VERBS v1 MCP surface
 * (`gbrain serve --surface verbs`). gbrain calls are best-effort: if the brain is
 * unreachable the delegate keeps working and healthCheck reports it.
 */
export class GbrainMemoryProvider implements MemoryProvider {
  readonly providerId = 'gbrain';
  private lastError: string | null = null;

  constructor(
    private readonly delegate: MemoryProvider,
    private readonly client?: GbrainClient,
    private readonly config: GbrainConfig = {},
  ) {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) return null;
    try {
      const result = await this.client.callTool(name, args);
      if (isGbrainError(result)) {
        this.lastError = `${name}: ${result.error}${result.message ? ` — ${result.message}` : ''}`;
        return null;
      }
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  }

  async healthCheck(): Promise<MemoryProviderHealth> {
    if (!this.client) {
      return { ok: true, details: 'gbrain delegate (filesystem) — no gbrain client configured' };
    }
    const probe = await this.call('recall', { query: 'healthcheck', limit: 1 });
    if (probe == null) {
      return { ok: true, details: `gbrain delegate active; brain unreachable: ${this.lastError ?? 'unknown'}` };
    }
    return { ok: true, details: 'gbrain brain reachable (MEMORY_VERBS v1)' };
  }

  private toEntry(fact: GbrainFact, sessionId: string, userId: string): MemoryEntry | null {
    if (!fact.fact) return null;
    return {
      id: `gbrain-${fact.fact_id ?? fact.id ?? ''}`,
      sessionId,
      userId,
      type: TYPE_BY_KIND[fact.kind ?? ''] ?? 'fact',
      content: fact.fact,
      metadata: { source: 'gbrain', factId: fact.fact_id, provenance: fact.provenance },
    };
  }

  private async recall(query: string, sessionId: string, userId: string, limit: number): Promise<MemoryEntry[]> {
    const args: Record<string, unknown> = { query, limit };
    if (this.config.budgetTokens) args.budget_tokens = this.config.budgetTokens;
    const res = (await this.call('recall', args)) as GbrainRecallResponse | null;
    return (res?.facts ?? [])
      .map((f) => this.toEntry(f, sessionId, userId))
      .filter((e): e is MemoryEntry => e !== null);
  }

  async getContext(sessionId: string, userId: string): Promise<MemoryContext> {
    const base = await this.delegate.getContext(sessionId, userId);
    const lastUser = [...base.shortTerm].reverse().find((m) => m.role === 'user');
    if (!lastUser || !this.client) return base;
    const facts = await this.recall(lastUser.content, sessionId, userId, this.config.recallLimit ?? 5);
    if (facts.length === 0) return base;
    return { ...base, semantic: [...facts, ...(base.semantic ?? [])] };
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const userId = options?.userId ?? '';
    const remote = await this.recall(query, '', userId, options?.limit ?? 10);
    if (remote.length > 0 || !this.delegate.search) return remote;
    return this.delegate.search(query, options);
  }

  /** Expire a gbrain fact (audit-trailed, never deleted). Accepts `gbrain-<id>` or raw fact_id. */
  async forget(id: string, reason?: string): Promise<boolean> {
    const factId = id.startsWith('gbrain-') ? id.slice('gbrain-'.length) : id;
    const res = await this.call('forget', reason ? { id: factId, reason } : { id: factId });
    return res != null;
  }

  private async syncEntry(entry: MemoryEntry): Promise<void> {
    const kind = KIND_BY_TYPE[entry.type];
    if (!kind || !this.client) return;
    const args: Record<string, unknown> = {
      fact: entry.content,
      provenance: `anvio session ${entry.sessionId} (user ${entry.userId})`.slice(0, 500),
      kind,
    };
    if (entry.id) args.request_id = `anvio-${entry.id}`;
    await this.call('remember', args);
  }

  storeConversation(sessionId: string, userId: string, messages: ChatMessage[]): Promise<void> {
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

export function createGbrainProvider(
  delegate: MemoryProvider,
  client?: GbrainClient,
  config?: GbrainConfig,
): GbrainMemoryProvider {
  return new GbrainMemoryProvider(delegate, client, config);
}
