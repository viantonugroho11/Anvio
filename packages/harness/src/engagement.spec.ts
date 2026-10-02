import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemEngagementStore } from './engagement.js';

describe('FilesystemEngagementStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'anvio-engagement-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns null for unknown threads', async () => {
    expect(await new FilesystemEngagementStore(root).get('slack', 't1')).toBeNull();
  });

  it('persists state across store instances', async () => {
    const state = { channel: 'slack', threadId: '1700.01/x', engaged: true, updatedAt: '2026-10-02T00:00:00Z' };
    await new FilesystemEngagementStore(root).set(state);
    expect(await new FilesystemEngagementStore(root).get('slack', '1700.01/x')).toEqual(state);
  });
});
