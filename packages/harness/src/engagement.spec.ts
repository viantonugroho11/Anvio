import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessChannelProfile } from '@anvio/core';
import { evaluateEngagement, FilesystemEngagementStore } from './engagement.js';

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

describe('evaluateEngagement with /1on1 owner lock', () => {
  const profile = { engageOn: 'mention', disengageOn: 'mention_other' } as HarnessChannelProfile;
  const locked = {
    channel: 'slack',
    threadId: 't1',
    engaged: true,
    updatedAt: '2026-10-02T00:00:00Z',
    owner: { userId: 'U_OWNER', since: '2026-10-02T00:00:00Z' },
  };

  it('engages the owner even when they mention someone else', () => {
    expect(evaluateEngagement(profile, locked, { senderId: 'U_OWNER', mentionedOther: true })).toBe(true);
  });

  it('ignores other users, even when they mention the bot', () => {
    expect(evaluateEngagement(profile, locked, { senderId: 'U_OTHER', mentionedBot: true })).toBe(false);
  });

  it('keeps normal rules when unlocked', () => {
    const open = { ...locked, owner: undefined, engaged: false };
    expect(evaluateEngagement(profile, open, { senderId: 'U_OTHER', mentionedBot: true })).toBe(true);
  });
});
