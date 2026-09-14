import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@anvio/core';
import { DiscordChannel } from './discord.js';
import { WhatsAppChannel } from './whatsapp.js';

interface Sent {
  url: string;
  method?: string;
  body: Record<string, unknown>;
}

function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      sent.push({
        url: String(url),
        method: init?.method,
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      });
      return {
        ok: true,
        status: 204,
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response;
    }),
  );
  return sent;
}

function sessionStore(session: unknown): SessionStore {
  return {
    get: async () => session,
    update: async () => session,
    getByChannelThread: async () => session,
  } as unknown as SessionStore;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Discord typing indicator (issue #76)', () => {
  it('posts to the channel typing endpoint', async () => {
    const sent = stubFetch();
    const channel = new DiscordChannel({
      botToken: 'tok',
      sessionBridge: {} as never,
      sessions: sessionStore({ id: 's1', metadata: { discord: { channelId: '999' } } }),
    });

    await channel.setTyping('s1', true);

    const typing = sent.find((s) => s.url.endsWith('/channels/999/typing'));
    expect(typing?.method).toBe('POST');

    await channel.setTyping('s1', false);
  });
});

describe('WhatsApp typing indicator (issue #76)', () => {
  it('references the inbound message it is replying to', async () => {
    const sent = stubFetch();
    const channel = new WhatsAppChannel({
      accessToken: 'tok',
      phoneNumberId: '123',
      verifyToken: 'v',
      sessionBridge: {} as never,
      sessions: sessionStore({
        id: 's1',
        metadata: { whatsapp: { waId: '628', lastInboundMessageId: 'wamid.ABC' } },
      }),
    });

    await channel.setTyping('s1', true);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.ABC',
      typing_indicator: { type: 'text' },
    });

    await channel.setTyping('s1', false);
  });

  it('skips the signal when no inbound message id is known', async () => {
    const sent = stubFetch();
    const channel = new WhatsAppChannel({
      accessToken: 'tok',
      phoneNumberId: '123',
      verifyToken: 'v',
      sessionBridge: {} as never,
      // A session restored from before the id was tracked has none.
      sessions: sessionStore({ id: 's1', metadata: { whatsapp: { waId: '628' } } }),
    });

    await channel.setTyping('s1', true);

    // The indicator cannot be faked without a message to attach it to.
    expect(sent).toEqual([]);

    await channel.setTyping('s1', false);
  });
});
