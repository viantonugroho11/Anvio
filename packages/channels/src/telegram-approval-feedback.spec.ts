import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@anvio/core';
import { TelegramChannel } from './telegram.js';

interface Call {
  method: string;
  body: Record<string, unknown>;
}

function makeChannel(outcome: { status: string }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({
      method: String(url).split('/').pop() ?? '',
      body: init?.body ? JSON.parse(init.body) : {},
    });
    return { json: async () => ({ ok: true, result: {} }) } as unknown as Response;
  }));

  const sessions = {
    get: async () => ({ id: 's1', metadata: { telegram: { chatId: 42 } } }),
    getByChannelThread: async () => ({ id: 's1', metadata: { telegram: { chatId: 42 } } }),
  } as unknown as SessionStore;

  const onApproval = vi.fn(async () => outcome as never);

  const channel = new TelegramChannel({
    botToken: 't',
    sessionBridge: { resolveOrCreate: vi.fn() } as never,
    sessions,
    onApproval,
  });

  return { channel, calls, onApproval };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Telegram approval feedback (#81)', () => {
  it('shows no toast on successful resolve', async () => {
    const { channel, calls } = makeChannel({ status: 'resolved' });

    await (channel as never as { handleUpdate(u: unknown): Promise<void> }).handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb-1', data: 'approve:r1',
        message: { chat: { id: 42 } }, from: { id: 7 },
      },
    });

    const answer = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(answer?.body.text).toBeUndefined();
  });

  it('shows alert toast when user is not authorized', async () => {
    const { channel, calls } = makeChannel({ status: 'not_authorized' });

    await (channel as never as { handleUpdate(u: unknown): Promise<void> }).handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb-2', data: 'approve:r1',
        message: { chat: { id: 42 } }, from: { id: 7 },
      },
    });

    const answer = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(answer?.body.text).toMatch(/not an approver/i);
    expect(answer?.body.show_alert).toBe(true);
  });

  it('shows toast when approval is already resolved', async () => {
    const { channel, calls } = makeChannel({ status: 'already_resolved' });

    await (channel as never as { handleUpdate(u: unknown): Promise<void> }).handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb-3', data: 'reject:r1',
        message: { chat: { id: 42 } }, from: { id: 7 },
      },
    });

    const answer = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(answer?.body.text).toMatch(/already been decided/i);
    expect(answer?.body.show_alert).toBe(true);
  });
});
