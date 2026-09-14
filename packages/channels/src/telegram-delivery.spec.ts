import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@anvio/core';
import { TelegramChannel } from './telegram.js';

interface Call {
  method: string;
  body: Record<string, unknown>;
}

/**
 * `fail` decides the Telegram response per call, so a test can make the first
 * sendMessage come back with a parse error and the retry succeed.
 */
function makeChannel(
  options: {
    fail?: (call: Call, index: number) => string | null;
    session?: unknown;
    onApproval?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const call: Call = {
      method: String(url).split('/').pop() ?? '',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    };
    calls.push(call);
    const description = options.fail?.(call, calls.length - 1) ?? null;
    return {
      json: async () => (description ? { ok: false, description } : { ok: true, result: {} }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const session =
    options.session === undefined
      ? { id: 's1', metadata: { telegram: { chatId: 42 } } }
      : options.session;

  const sessions = {
    get: async () => session,
    getByChannelThread: async () => session,
  } as unknown as SessionStore;

  const channel = new TelegramChannel({
    botToken: 't',
    sessionBridge: {
      resolveOrCreate: vi.fn(async () => ({ id: 'freshly-created' })),
    } as never,
    sessions,
    onApproval: options.onApproval,
  });

  return { channel, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Telegram Markdown fallback (issue #71)', () => {
  it('resends as plain text when Markdown parsing is rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { channel, calls } = makeChannel({
      fail: (call, index) =>
        call.method === 'sendMessage' && index === 0
          ? "Bad Request: can't parse entities: Can't find end of the entity"
          : null,
    });

    await channel.sendMessage('s1', {
      sessionId: 's1',
      type: 'done',
      content: 'explain anvio_channel__request_approval',
    });

    const sends = calls.filter((c) => c.method === 'sendMessage');
    expect(sends).toHaveLength(2);
    expect(sends[0]!.body.parse_mode).toBe('Markdown');
    // The retry drops formatting so the user gets text rather than nothing.
    expect(sends[1]!.body.parse_mode).toBeUndefined();
    expect(sends[1]!.body.text).toBe('explain anvio_channel__request_approval');
  });

  it('does not retry a failure that has nothing to do with formatting', async () => {
    const { channel, calls } = makeChannel({
      fail: (call) => (call.method === 'sendMessage' ? 'Forbidden: bot was blocked' : null),
    });

    await expect(
      channel.sendMessage('s1', { sessionId: 's1', type: 'done', content: 'hi' }),
    ).rejects.toThrow(/blocked/);
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });
});

describe('Telegram approval callback (issue #73)', () => {
  it('does not fabricate a session when the original is gone', async () => {
    const onApproval = vi.fn();
    const { channel, calls } = makeChannel({ session: null, onApproval });

    await (channel as unknown as { handleUpdate(u: unknown): Promise<void> }).handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb-1',
        data: 'approve:req-1',
        message: { chat: { id: 42 } },
        from: { id: 7 },
      },
    });

    expect(onApproval).not.toHaveBeenCalled();
    const answer = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(answer?.body.text).toMatch(/expired/i);
  });

  it('resolves against the existing session when there is one', async () => {
    const onApproval = vi.fn(async () => ({ status: 'resolved' as const }));
    const { channel } = makeChannel({ onApproval });

    await (channel as unknown as { handleUpdate(u: unknown): Promise<void> }).handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb-1',
        data: 'approve:req-1',
        message: { chat: { id: 42 } },
        from: { id: 7 },
      },
    });

    expect(onApproval).toHaveBeenCalledWith('s1', 'req-1', true, 'telegram:7');
  });
});

describe('Telegram long replies', () => {
  it('splits past 4096 and keeps every part deliverable', async () => {
    const { channel, calls } = makeChannel();
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} of a long answer`).join('\n');

    await channel.sendMessage('s1', { sessionId: 's1', type: 'done', content: body });

    const sends = calls.filter((c) => c.method === 'sendMessage');
    expect(sends.length).toBeGreaterThan(1);
    for (const send of sends) expect(String(send.body.text).length).toBeLessThanOrEqual(4096);
  });
});
