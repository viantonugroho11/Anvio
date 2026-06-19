import type { MemoryEntry, MemoryEntryType } from '@anvio/core';
import type { RecallHit } from '../../recall-index.js';

export interface SqliteFtsDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

/** FTS5-backed cross-session recall — Level 2 memory search. */
export class SqliteFtsRecall {
  private readonly db: SqliteFtsDb;

  constructor(db: SqliteFtsDb) {
    this.db = db;
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        session_id UNINDEXED,
        user_id UNINDEXED,
        entry_type UNINDEXED,
        tokenize='porter'
      );
    `);
  }

  index(entry: MemoryEntry): void {
    const userId = entry.userId;
    const sessionId = entry.sessionId;
    const type = entry.type;
    this.db
      .prepare(
        `INSERT INTO memory_fts (content, session_id, user_id, entry_type) VALUES (?, ?, ?, ?)`,
      )
      .run(entry.content, sessionId, userId, type);
  }

  search(userId: string, query: string, limit = 5): RecallHit[] {
    const terms = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .map((t) => `"${t.replace(/"/g, '')}"`)
      .join(' ');

    if (!terms) return [];

    const rows = this.db
      .prepare(
        `SELECT session_id, entry_type, snippet(memory_fts, 0, '[', ']', '…', 20) AS snippet
         FROM memory_fts
         WHERE memory_fts MATCH ? AND user_id = ?
         LIMIT ?`,
      )
      .all(terms, userId, limit) as Array<{
      session_id: string;
      entry_type: MemoryEntryType;
      snippet: string;
    }>;

    return rows.map((row, i) => ({
      sessionId: row.session_id,
      type: row.entry_type,
      content: row.snippet,
      score: limit - i,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export async function openSqliteFtsRecall(dbPath: string): Promise<SqliteFtsRecall | null> {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default as new (path: string) => SqliteFtsDb;
    return new SqliteFtsRecall(new Database(dbPath));
  } catch {
    return null;
  }
}
