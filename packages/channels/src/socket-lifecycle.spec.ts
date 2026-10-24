import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelSessionBridge } from './channel-session-bridge.js';
import { DiscordChannel } from './discord.js';
import { ReconnectScheduler, RecentIds } from './reconnect.js';
import { SlackChannel } from './slack.js';

/** Minimal stand-in for the global WebSocket the adapters construct. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;
  sent: unknown[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }

  /** Server-side drop. */
  drop(code = 1006): void {
    this.onclose?.({ code });
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const bridge = {} as ChannelSessionBridge;
const sessions = {} as never;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SlackChannel Socket Mode', () => {
  function stubSlack(urls = ['wss://slack.example/ticket-1', 'wss://slack.example/ticket-2']) {
    const calls: Array<{ url: string; auth?: string }> = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
        return jsonResponse({ ok: true, url: urls[Math.min(n++, urls.length - 1)] });
      }),
    );
    return calls;
  }

  it('opens the socket from apps.connections.open and keeps the app token out of the URL', async () => {
    const calls = stubSlack();
    const slack = new SlackChannel({
      botToken: 'xoxb-1',
      appToken: 'xapp-secret',
      sessionBridge: bridge,
      sessions,
    });
    await slack.start();
    expect(calls[0]).toEqual({
      url: 'https://slack.com/api/apps.connections.open',
      auth: 'Bearer xapp-secret',
    });
    expect(FakeWebSocket.instances[0]!.url).toBe('wss://slack.example/ticket-1');
    expect(FakeWebSocket.instances[0]!.url).not.toContain('xapp-secret');
    await slack.stop();
  });

  it('does not reconnect after stop()', async () => {
    stubSlack();
    const slack = new SlackChannel({
      botToken: 'xoxb',
      appToken: 'xapp',
      sessionBridge: bridge,
      sessions,
    });
    await slack.start();
    await slack.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects after a drop and keeps retrying when a reconnect fails', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        if (n === 2) return jsonResponse({ ok: false, error: 'internal_error' });
        return jsonResponse({ ok: true, url: `wss://slack.example/t${n}` });
      }),
    );
    const slack = new SlackChannel({
      botToken: 'xoxb',
      appToken: 'xapp',
      sessionBridge: bridge,
      sessions,
    });
    await slack.start();
    FakeWebSocket.instances[0]!.drop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(FakeWebSocket.instances.at(-1)!.url).toBe('wss://slack.example/t3');
    await slack.stop();
  });

  it('acknowledges but does not re-handle a redelivered envelope', async () => {
    stubSlack();
    const slack = new SlackChannel({
      botToken: 'xoxb',
      appToken: 'xapp',
      sessionBridge: bridge,
      sessions,
    });
    const handled = vi
      .spyOn(slack as unknown as { handleMessage: () => Promise<void> }, 'handleMessage')
      .mockResolvedValue();
    await slack.start();
    const ws = FakeWebSocket.instances[0]!;
    const envelope = {
      type: 'events_api',
      envelope_id: 'env-1',
      payload: { event: { type: 'message', text: 'hi', user: 'U1', channel: 'C1' } },
    };
    ws.receive(envelope);
    ws.receive(envelope);
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent).toEqual([{ envelope_id: 'env-1' }, { envelope_id: 'env-1' }]);
    expect(handled).toHaveBeenCalledTimes(1);
    await slack.stop();
  });
});

describe('DiscordChannel gateway', () => {
  function stubDiscord() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ url: 'wss://gateway.discord.example' })),
    );
  }

  it('does not reconnect after stop()', async () => {
    stubDiscord();
    const discord = new DiscordChannel({ botToken: 'token', sessionBridge: bridge, sessions });
    await discord.start();
    await discord.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('heartbeats with the last sequence and resumes after a drop', async () => {
    stubDiscord();
    const discord = new DiscordChannel({ botToken: 'token', sessionBridge: bridge, sessions });
    await discord.start();
    const first = FakeWebSocket.instances[0]!;
    first.receive({ op: 10, d: { heartbeat_interval: 1_000 } });
    first.receive({
      op: 0,
      t: 'READY',
      s: 1,
      d: { session_id: 'sess-9', resume_gateway_url: 'wss://resume.discord.example' },
    });
    first.receive({ op: 0, t: 'GUILD_CREATE', s: 2, d: {} });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(first.sent).toContainEqual({ op: 1, d: 2 });

    first.drop();
    await vi.advanceTimersByTimeAsync(120_000);
    const second = FakeWebSocket.instances[1]!;
    expect(second.url).toBe('wss://resume.discord.example?v=10&encoding=json');
    second.receive({ op: 10, d: { heartbeat_interval: 1_000 } });
    expect(second.sent[0]).toEqual({ op: 6, d: { token: 'token', session_id: 'sess-9', seq: 2 } });
    await discord.stop();
  });

  it('closes a zombie connection whose heartbeat is never acknowledged', async () => {
    stubDiscord();
    const discord = new DiscordChannel({ botToken: 'token', sessionBridge: bridge, sessions });
    await discord.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.receive({ op: 10, d: { heartbeat_interval: 1_000 } });
    await vi.advanceTimersByTimeAsync(1_000); // heartbeat sent
    await vi.advanceTimersByTimeAsync(1_000); // no ACK → close
    expect(ws.closed).toBe(true);
    await discord.stop();
  });

  it('does not reconnect on a fatal close code', async () => {
    stubDiscord();
    const discord = new DiscordChannel({ botToken: 'bad', sessionBridge: bridge, sessions });
    await discord.start();
    FakeWebSocket.instances[0]!.drop(4004);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('ReconnectScheduler', () => {
  it('backs off exponentially up to the cap', () => {
    const scheduler = new ReconnectScheduler('t', async () => {}, {
      baseMs: 1_000,
      maxMs: 8_000,
      random: () => 1,
    });
    scheduler.begin();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      delays.push(scheduler.nextDelayMs());
      scheduler.schedule('x');
      vi.runOnlyPendingTimers();
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    scheduler.connected();
    expect(scheduler.nextDelayMs()).toBe(1_000);
    scheduler.stop();
  });
});

describe('RecentIds', () => {
  it('reports repeats and forgets the oldest past capacity', () => {
    const ids = new RecentIds(2);
    expect(ids.add('a')).toBe(true);
    expect(ids.add('a')).toBe(false);
    ids.add('b');
    ids.add('c');
    expect(ids.add('a')).toBe(true);
  });
});
