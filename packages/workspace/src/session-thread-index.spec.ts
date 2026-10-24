import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { FilesystemSessionStore } from './index.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function store(): Promise<{
  sessions: FilesystemSessionStore;
  storage: FilesystemStorageProvider;
  dir: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-threads-'));
  dirs.push(dir);
  const storage = new FilesystemStorageProvider(dir);
  return { sessions: new FilesystemSessionStore(storage), storage, dir };
}

function threadSession(threadId: string): Omit<StoredSession, 'id' | 'createdAt' | 'lastActiveAt'> {
  return {
    userId: 'u',
    agentName: 'a',
    channel: 'slack',
    messages: [],
    status: 'idle',
    channelThread: { channel: 'slack', threadId },
  };
}

describe('FilesystemSessionStore.getByChannelThread', () => {
  it('resolves a known thread with one read, not one read per stored session', async () => {
    const { sessions, storage } = await store();
    for (let i = 0; i < 50; i++) await sessions.create(threadSession(`T${i}`));
    const reads = vi.spyOn(storage, 'readJson');
    const found = await sessions.getByChannelThread('slack', 'T42');
    expect(found?.channelThread?.threadId).toBe('T42');
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('finds sessions written by another process (index miss falls back to a scan)', async () => {
    const { sessions, dir } = await store();
    const other = new FilesystemSessionStore(new FilesystemStorageProvider(dir));
    const created = await other.create(threadSession('T-other'));
    expect((await sessions.getByChannelThread('slack', 'T-other'))?.id).toBe(created.id);
  });

  it('does not return a session whose thread changed or whose file is gone', async () => {
    const { sessions, dir } = await store();
    const moved = await sessions.create(threadSession('T-old'));
    await sessions.update(moved.id, { channelThread: { channel: 'slack', threadId: 'T-new' } });
    expect(await sessions.getByChannelThread('slack', 'T-old')).toBeNull();
    expect((await sessions.getByChannelThread('slack', 'T-new'))?.id).toBe(moved.id);

    const removed = await sessions.create(threadSession('T-gone'));
    await fs.rm(path.join(dir, 'sessions', `${removed.id}.json`));
    expect(await sessions.getByChannelThread('slack', 'T-gone')).toBeNull();
  });

  it('returns null for an unknown thread', async () => {
    const { sessions } = await store();
    await sessions.create(threadSession('T1'));
    expect(await sessions.getByChannelThread('slack', 'nope')).toBeNull();
    expect(await sessions.getByChannelThread('telegram', 'T1')).toBeNull();
  });
});
