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
  /** ADR 0035: write session turns as a gbrain timeline page. */
  episodic?: boolean;
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
/** gbrain page holding one Anvio session's episodic timeline (ADR 0035). */
export function sessionTimelineSlug(sessionId: string): string {
  return `anvio/sessions/${sessionId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

const SUMMARY_CHARS = 160;
const DETAIL_CHARS = 2000;

export class GbrainMemoryProvider implements MemoryProvider {
  readonly providerId = 'gbrain';
  private lastError: string | null = null;
  /** Sessions whose timeline page is known to exist. */
  private readonly pagesReady = new Set<string>();
  /** Messages already appended per session (in-process; request_id makes replays no-ops). */
  private readonly syncedTurns = new Map<string, number>();

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

  async storeConversation(sessionId: string, userId: string, messages: ChatMessage[]): Promise<void> {
    await this.delegate.storeConversation(sessionId, userId, messages);
    if (this.config.episodic && this.client) await this.appendTimeline(sessionId, userId, messages);
  }

  /** put_page REPLACES a page, so it only runs when get_page reports the page missing. */
  private async ensureTimelinePage(sessionId: string, userId: string): Promise<boolean> {
    if (this.pagesReady.has(sessionId)) return true;
    const slug = sessionTimelineSlug(sessionId);
    const existing = await this.call('get_page', { slug });
    if (existing == null) {
      if (!this.lastError?.includes('not_found')) return false;
      const content = [
        '---',
        `title: Anvio session ${sessionId}`,
        'type: conversation',
        `anvio_session: ${sessionId}`,
        `anvio_user: ${userId}`,
        '---',
        '',
        `Episodic timeline of Anvio session \`${sessionId}\`.`,
        '',
      ].join('\n');
      if ((await this.call('put_page', { slug, content })) == null) return false;
    }
    this.pagesReady.add(sessionId);
    return true;
  }

  private async appendTimeline(sessionId: string, userId: string, messages: ChatMessage[]): Promise<void> {
    const from = this.syncedTurns.get(sessionId) ?? 0;
    const turns = messages.slice(from).filter((m) => m.role === 'user' || m.role === 'assistant');
    if (turns.length === 0 || !(await this.ensureTimelinePage(sessionId, userId))) return;
    const slug = sessionTimelineSlug(sessionId);
    const date = new Date().toISOString().slice(0, 10);
    for (const [offset, message] of messages.slice(from).entries()) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const text = message.content.trim();
      if (!text) continue;
      const firstLine = text.split('\n')[0]!;
      const ok = await this.call('add_timeline_entry', {
        slug,
        date,
        summary: `${message.role}: ${firstLine.slice(0, SUMMARY_CHARS)}`,
        detail: text.length > firstLine.length || firstLine.length > SUMMARY_CHARS ? text.slice(0, DETAIL_CHARS) : undefined,
        source: `anvio:session/${sessionId}`,
        // Deterministic per turn: a replay after restart is a no-op in gbrain.
        request_id: `anvio-${sessionId}-${from + offset}`,
      });
      if (ok == null) return; // stop at the first failure; the next call retries from here
      this.syncedTurns.set(sessionId, from + offset + 1);
    }
    this.syncedTurns.set(sessionId, messages.length);
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
