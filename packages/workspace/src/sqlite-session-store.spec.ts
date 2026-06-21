import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteSessionStore } from './sqlite-session-store.js';

describe('SqliteSessionStore', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-sqlite-'));
    dbPath = path.join(tmpDir, 'state.db');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates and retrieves sessions', async () => {
    const mod = await import('better-sqlite3');
    const store = new SqliteSessionStore(new mod.default(dbPath));

    const created = await store.create({
      userId: 'u1',
      agentName: 'architect',
      channel: 'telegram',
      messages: [],
      status: 'idle',
    });

    const loaded = await store.get(created.id);
    expect(loaded?.agentName).toBe('architect');
    store.close();
  });

  it('finds session by channel thread', async () => {
    const mod = await import('better-sqlite3');
    const store = new SqliteSessionStore(new mod.default(dbPath));

    await store.create({
      userId: 'u1',
      agentName: 'architect',
      channel: 'slack',
      messages: [],
      status: 'idle',
      channelThread: { channel: 'slack', threadId: 'T123' },
    });

    const found = await store.getByChannelThread('slack', 'T123');
    expect(found?.channel).toBe('slack');
    store.close();
  });

  it('searches messages via FTS', async () => {
    const mod = await import('better-sqlite3');
    const store = new SqliteSessionStore(new mod.default(dbPath));

    await store.create({
      userId: 'u1',
      agentName: 'architect',
      channel: 'cli',
      messages: [{ role: 'user', content: 'implement JWT middleware' }],
      status: 'completed',
    });

    const hits = await store.searchMessages('JWT middleware', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain('JWT');
    store.close();
  });
});
