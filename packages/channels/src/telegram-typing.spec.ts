import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from './telegram.js';
import type { SessionStore } from '@anvio/core';

function makeChannel() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({
      method: String(url).split('/').pop() ?? '',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return { json: async () => ({ ok: true, result: {} }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const sessions = {
    get: async () => ({
      id: 's1',
      metadata: { telegram: { chatId: 42, messageThreadId: 7 } },
    }),
  } as unknown as SessionStore;

  const channel = new TelegramChannel({
    botToken: 't',
    sessionBridge: {} as never,
    sessions,
  });

  return { channel, calls };
}

describe('TelegramChannel typing indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends a typing chat action into the right forum topic', async () => {
    const { channel, calls } = makeChannel();

    await channel.setTyping('s1', true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('sendChatAction');
    expect(calls[0]?.body).toMatchObject({
      chat_id: 42,
      message_thread_id: 7,
      action: 'typing',
    });

    await channel.setTyping('s1', false);
  });

  it('re-sends the action before Telegram expires it', async () => {
    const { channel, calls } = makeChannel();

    await channel.setTyping('s1', true);
    await vi.advanceTimersByTimeAsync(9000);

    expect(calls.filter((c) => c.method === 'sendChatAction').length).toBeGreaterThanOrEqual(3);

    await channel.setTyping('s1', false);
  });

  it('stops the keepalive and does not start a second one', async () => {
    const { channel, calls } = makeChannel();

    await channel.setTyping('s1', true);
    await channel.setTyping('s1', true);
    const started = calls.length;

    await channel.setTyping('s1', false);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(started).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('clears every keepalive on stop()', async () => {
    const { channel, calls } = makeChannel();

    await channel.setTyping('s1', true);
    await channel.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(calls).toHaveLength(1);
  });
});
