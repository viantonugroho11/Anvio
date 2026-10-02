import type { ChannelType, SlashCommand } from '@anvio/core';

/** Channels whose sender ids are not stable user identities — a lock would be meaningless. */
const UNSUPPORTED_CHANNELS = new Set(['sms', 'email', 'cli', 'rest']);

export interface ThreadOwnerPort {
  setThreadOwner(
    channel: ChannelType,
    threadId: string,
    userId: string | null,
  ): Promise<{ previousOwner?: string }>;
  getThreadOwner(channel: ChannelType, threadId: string): Promise<string | undefined>;
}

/** `/1on1 [on|off|status]` — lock a thread to the caller (ADR 0032). */
export function createOneOnOneCommand(harness: ThreadOwnerPort): SlashCommand {
  return {
    name: '1on1',
    description: 'Lock this thread to you: /1on1 [on|off|status]',
    scope: 'group',
    handler: async (ctx) => {
      if (UNSUPPORTED_CHANNELS.has(ctx.channel)) {
        return { swallow: true, reply: `/1on1 is not supported on ${ctx.channel}.` };
      }
      const channel = ctx.channel as ChannelType;
      const sub = (ctx.argsList[0] ?? 'on').toLowerCase();
      const owner = await harness.getThreadOwner(channel, ctx.threadId);

      if (sub === 'status') {
        return { swallow: true, reply: owner ? `Thread locked to <@${owner}>.` : 'Thread is not locked.' };
      }
      if (sub === 'off') {
        if (!owner) return { swallow: true, reply: 'Thread is not locked.' };
        if (owner !== ctx.userId) {
          return { swallow: true, reply: `Only <@${owner}> can release this thread.` };
        }
        await harness.setThreadOwner(channel, ctx.threadId, null);
        return { swallow: true, reply: 'Thread unlocked. Normal engagement rules apply.' };
      }
      if (sub !== 'on') {
        return { swallow: true, reply: 'Usage: /1on1 [on|off|status]' };
      }
      if (owner && owner !== ctx.userId) {
        return { swallow: true, reply: `Thread already locked to <@${owner}>.` };
      }
      await harness.setThreadOwner(channel, ctx.threadId, ctx.userId);
      return { swallow: true, reply: 'Thread locked to you. Others are ignored until `/1on1 off`.' };
    },
  };
}
