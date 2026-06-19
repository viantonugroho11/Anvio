import type { MemoryEntry } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';

export interface RecallHit {
  sessionId: string;
  type: MemoryEntry['type'];
  content: string;
  score: number;
}

/** Lightweight cross-session recall — filesystem keyword index (no FTS5 required for Level 1). */
export class MemoryRecallIndex {
  private readonly indexKey = 'memory/_recall-index.json';

  constructor(private readonly storage: FilesystemStorageProvider) {}

  async indexEntry(entry: MemoryEntry): Promise<void> {
    const index = await this.loadIndex();
    const tokens = tokenize(entry.content);
    if (tokens.length === 0) return;

    index.entries.push({
      sessionId: entry.sessionId,
      userId: entry.userId,
      type: entry.type,
      content: entry.content.slice(0, 500),
      tokens,
      createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : (entry.createdAt ?? new Date().toISOString()),
    });

    if (index.entries.length > 500) {
      index.entries = index.entries.slice(-500);
    }
    await this.storage.writeJson(this.indexKey, index);
  }

  async recall(userId: string, query: string, limit = 5): Promise<RecallHit[]> {
    const index = await this.loadIndex();
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scored = index.entries
      .filter((e) => e.userId === userId)
      .map((e) => ({
        sessionId: e.sessionId,
        type: e.type,
        content: e.content,
        score: scoreOverlap(queryTokens, e.tokens),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  private async loadIndex(): Promise<{
    entries: Array<{
      sessionId: string;
      userId: string;
      type: MemoryEntry['type'];
      content: string;
      tokens: string[];
      createdAt: string;
    }>;
  }> {
    return (
      (await this.storage.readJson(this.indexKey)) ?? {
        entries: [],
      }
    );
  }
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function scoreOverlap(query: string[], doc: string[]): number {
  const docSet = new Set(doc);
  return query.filter((t) => docSet.has(t)).length;
}
