import { describe, expect, it } from 'vitest';
import type { ChannelHubPort, SessionStore } from '@anvio/core';
import { harnessChannelProfileSchema, harnessDefaultsSchema, parseSoulPolicy } from '@anvio/core';
import { MemoryEngagementStore } from './engagement.js';
import { createHarnessGateway } from './gateway.js';

function gateway() {
  return createHarnessGateway({
    defaults: harnessDefaultsSchema.parse({ enabled: true }),
    profiles: [
      harnessChannelProfileSchema.parse({
        name: 'team',
        channels: ['slack'],
        engageOn: 'mention',
        disengageOn: 'mention_other',
      }),
    ],
    policy: parseSoulPolicy({}),
    channelHub: {} as ChannelHubPort,
    sessions: {} as SessionStore,
    engagementStore: new MemoryEngagementStore(),
  });
}

const msg = (userId: string, extra: { mentionedBot?: boolean; mentionedOther?: boolean } = {}) => ({
  channel: 'slack' as const,
  threadId: 't1',
  userId,
  content: 'hi',
  trustTier: 'allowed' as const,
  ...extra,
});

describe('HarnessGateway /1on1 lock', () => {
  it('only the owner gets through while locked, and unlock restores normal rules', async () => {
    const gw = gateway();
    expect((await gw.handleInbound(msg('U1', { mentionedBot: true }))).decision).toBe('allow');

    expect(await gw.setThreadOwner('slack', 't1', 'U1')).toEqual({ previousOwner: undefined });
    expect((await gw.handleInbound(msg('U2', { mentionedBot: true }))).decision).toBe('disengage');
    expect((await gw.handleInbound(msg('U1', { mentionedOther: true }))).decision).toBe('allow');
    expect(await gw.getThreadOwner('slack', 't1')).toBe('U1');

    await gw.setThreadOwner('slack', 't1', null);
    expect(await gw.getThreadOwner('slack', 't1')).toBeUndefined();
    expect((await gw.handleInbound(msg('U2', { mentionedBot: true }))).decision).toBe('allow');
  });
});
