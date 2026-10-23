import { describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelType, OutboundMessage } from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelHub } from './channel-hub.js';

function adapter(channelType: string, start: () => Promise<void>): ChannelAdapter {
  return {
    channelType: channelType as ChannelType,
    onMessage() {},
    sendMessage: async () => {},
    start,
    stop: async () => {},
  } as unknown as ChannelAdapter;
}

describe('ChannelHub.startAll isolation (audit T-012, probe Q5)', () => {
  it('starts the healthy channels and reports the failed one instead of rejecting', async () => {
    const hub = new ChannelHub();
    let slackStarted = false;
    hub.register(adapter('telegram', async () => Promise.reject(new Error('401 Unauthorized'))));
    hub.register(
      adapter('slack', async () => {
        slackStarted = true;
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failures = await hub.startAll();

    expect(slackStarted).toBe(true);
    expect(failures).toEqual([{ channel: 'telegram', error: '401 Unauthorized' }]);
    expect(log).toHaveBeenCalledWith('[channels] telegram failed to start: 401 Unauthorized');
    log.mockRestore();
  });
});

class SocketAdapter extends BaseChannelAdapter {
  readonly channelType = 'slack' as ChannelType;
  async sendMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  protected async sendApprovalRequestWithActions(): Promise<void> {}

  /** What a WebSocket `onmessage` does with a raw frame. */
  receive(raw: string, handle: (frame: unknown) => Promise<void>): void {
    this.runGuarded('socket message', () => handle(JSON.parse(raw)));
  }
}

describe('socket callbacks cannot crash the process (audit T-005)', () => {
  it('logs a malformed frame and a failing handler instead of leaving an unhandled rejection', async () => {
    const socket = new SocketAdapter();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    socket.receive('not json', async () => {});
    socket.receive('{"ok":true}', async () => {
      throw new Error('session store unavailable');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]).toEqual(['[slack] socket message failed:', 'session store unavailable']);
    log.mockRestore();
  });
});
