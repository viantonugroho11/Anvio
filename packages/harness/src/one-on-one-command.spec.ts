import { describe, expect, it } from 'vitest';
import type { SlashCommandContext } from '@anvio/core';
import { createOneOnOneCommand, type ThreadOwnerPort } from './one-on-one-command.js';

function fakeHarness(): ThreadOwnerPort {
  const owners = new Map<string, string>();
  return {
    async setThreadOwner(channel, threadId, userId) {
      const key = `${channel}:${threadId}`;
      const previousOwner = owners.get(key);
      if (userId) owners.set(key, userId);
      else owners.delete(key);
      return { previousOwner };
    },
    async getThreadOwner(channel, threadId) {
      return owners.get(`${channel}:${threadId}`);
    },
  };
}

const ctx = (userId: string, args: string[] = [], channel = 'slack'): SlashCommandContext => ({
  channel,
  sessionId: 's1',
  userId,
  threadId: 't1',
  isDm: false,
  argsRaw: args.join(' '),
  argsList: args,
});

describe('/1on1', () => {
  it('locks, refuses takeover and foreign release, then unlocks', async () => {
    const cmd = createOneOnOneCommand(fakeHarness());
    expect((await cmd.handler(ctx('U1'))).reply).toContain('locked to you');
    expect((await cmd.handler(ctx('U2'))).reply).toContain('already locked to <@U1>');
    expect((await cmd.handler(ctx('U2', ['off']))).reply).toContain('Only <@U1>');
    expect((await cmd.handler(ctx('U2', ['status']))).reply).toContain('<@U1>');
    expect((await cmd.handler(ctx('U1', ['off']))).reply).toContain('unlocked');
    expect((await cmd.handler(ctx('U1', ['status']))).reply).toBe('Thread is not locked.');
  });

  it('mentions the bare platform id for prefixed session user ids', async () => {
    const cmd = createOneOnOneCommand(fakeHarness());
    await cmd.handler(ctx('slack:U1'));
    expect((await cmd.handler(ctx('slack:U2'))).reply).toBe('Thread already locked to <@U1>.');
  });

  it('rejects channels without stable user ids', async () => {
    const res = await createOneOnOneCommand(fakeHarness()).handler(ctx('+62811', [], 'sms'));
    expect(res).toEqual({ swallow: true, reply: '/1on1 is not supported on sms.' });
  });
});
