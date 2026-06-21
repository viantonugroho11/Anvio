import path from 'node:path';
import type { AgentRunStatus, ChannelType, SessionStore, StoredSession } from '@anvio/core';
import { v4 as uuidv4 } from 'uuid';

export interface SqliteSessionDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type SessionRow = {
  id: string;
  user_id: string;
  agent_name: string;
  channel: string;
  status: string;
  messages_json: string;
  channel_thread_channel: string | null;
  channel_thread_id: string | null;
  parent_session_id: string | null;
  detached: number;
  pending_approval_json: string | null;
  metadata_json: string | null;
  created_at: string;
  last_active_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  channel_thread_channel TEXT,
  channel_thread_id TEXT,
  parent_session_id TEXT,
  detached INTEGER NOT NULL DEFAULT 0,
  pending_approval_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_channel_thread
  ON sessions(channel_thread_channel, channel_thread_id);
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  session_id UNINDEXED,
  agent_name UNINDEXED,
  channel UNINDEXED,
  content,
  tokenize='porter'
);
`;

function rowToSession(row: SessionRow): StoredSession {
  return {
    id: row.id,
    userId: row.user_id,
    agentName: row.agent_name,
    channel: row.channel,
    status: row.status as AgentRunStatus,
    messages: JSON.parse(row.messages_json) as StoredSession['messages'],
    channelThread:
      row.channel_thread_channel && row.channel_thread_id
        ? { channel: row.channel_thread_channel as ChannelType, threadId: row.channel_thread_id }
        : undefined,
    parentSessionId: row.parent_session_id ?? undefined,
    detached: row.detached === 1,
    pendingApproval: row.pending_approval_json
      ? (JSON.parse(row.pending_approval_json) as StoredSession['pendingApproval'])
      : undefined,
    metadata: row.metadata_json
      ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
      : undefined,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

/** Hermes-style SQLite session persistence with FTS5 message search. */
export class SqliteSessionStore implements SessionStore {
  private readonly db: SqliteSessionDb;

  constructor(db: SqliteSessionDb) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  async create(
    session: Omit<StoredSession, 'id' | 'createdAt' | 'lastActiveAt'>,
  ): Promise<StoredSession> {
    const now = new Date().toISOString();
    const stored: StoredSession = {
      ...session,
      id: uuidv4(),
      createdAt: now,
      lastActiveAt: now,
    };
    this.persist(stored);
    this.indexFts(stored);
    return stored;
  }

  async get(id: string): Promise<StoredSession | null> {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async getByChannelThread(channel: string, threadId: string): Promise<StoredSession | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE channel_thread_channel = ? AND channel_thread_id = ?
         ORDER BY last_active_at DESC LIMIT 1`,
      )
      .get(channel, threadId) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async update(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: StoredSession = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      lastActiveAt: new Date().toISOString(),
    };
    this.persist(updated);
    this.reindexFts(updated);
    return updated;
  }

  async list(userId?: string): Promise<StoredSession[]> {
    const rows = userId
      ? (this.db
          .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC')
          .all(userId) as SessionRow[])
      : (this.db
          .prepare('SELECT * FROM sessions ORDER BY last_active_at DESC')
          .all() as SessionRow[]);
    return rows.map(rowToSession);
  }

  async listActive(userId?: string): Promise<StoredSession[]> {
    const active: AgentRunStatus[] = [
      'assembling_context',
      'calling_model',
      'tool_executing',
      'awaiting_approval',
      'storing_memory',
    ];
    const sessions = await this.list(userId);
    return sessions.filter((s) => active.includes(s.status));
  }

  async searchMessages(
    query: string,
    limit = 10,
  ): Promise<Array<{ sessionId: string; agentName: string; channel: string; snippet: string }>> {
    const terms = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t.replace(/"/g, '')}"`)
      .join(' ');
    if (!terms) return [];

    const rows = this.db
      .prepare(
        `SELECT session_id, agent_name, channel,
                snippet(sessions_fts, 3, '[', ']', '…', 24) AS snippet
         FROM sessions_fts
         WHERE sessions_fts MATCH ?
         LIMIT ?`,
      )
      .all(terms, limit) as Array<{
      session_id: string;
      agent_name: string;
      channel: string;
      snippet: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      agentName: row.agent_name,
      channel: row.channel,
      snippet: row.snippet,
    }));
  }

  close(): void {
    this.db.close();
  }

  private persist(session: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, user_id, agent_name, channel, status, messages_json,
          channel_thread_channel, channel_thread_id, parent_session_id,
          detached, pending_approval_json, metadata_json, created_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          agent_name = excluded.agent_name,
          channel = excluded.channel,
          status = excluded.status,
          messages_json = excluded.messages_json,
          channel_thread_channel = excluded.channel_thread_channel,
          channel_thread_id = excluded.channel_thread_id,
          parent_session_id = excluded.parent_session_id,
          detached = excluded.detached,
          pending_approval_json = excluded.pending_approval_json,
          metadata_json = excluded.metadata_json,
          last_active_at = excluded.last_active_at`,
      )
      .run(
        session.id,
        session.userId,
        session.agentName,
        session.channel,
        session.status,
        JSON.stringify(session.messages),
        session.channelThread?.channel ?? null,
        session.channelThread?.threadId ?? null,
        session.parentSessionId ?? null,
        session.detached ? 1 : 0,
        session.pendingApproval ? JSON.stringify(session.pendingApproval) : null,
        session.metadata ? JSON.stringify(session.metadata) : null,
        session.createdAt,
        session.lastActiveAt,
      );
  }

  private indexFts(session: StoredSession): void {
    const content = session.messages.map((m) => m.content).join('\n');
    if (!content.trim()) return;
    this.db
      .prepare(
        `INSERT INTO sessions_fts (session_id, agent_name, channel, content)
         VALUES (?, ?, ?, ?)`,
      )
      .run(session.id, session.agentName, session.channel, content);
  }

  private reindexFts(session: StoredSession): void {
    this.db.prepare('DELETE FROM sessions_fts WHERE session_id = ?').run(session.id);
    this.indexFts(session);
  }
}

export async function openSqliteSessionStore(dbPath: string): Promise<SqliteSessionStore> {
  const mod = await import('better-sqlite3');
  const Database = mod.default as new (path: string) => SqliteSessionDb;
  return new SqliteSessionStore(new Database(dbPath));
}

export function resolveSessionDbPath(workspaceRoot: string, connectionString?: string): string {
  if (connectionString) {
    return connectionString.startsWith('sqlite:')
      ? connectionString.slice('sqlite:'.length)
      : connectionString;
  }
  return path.join(workspaceRoot, 'state.db');
}
