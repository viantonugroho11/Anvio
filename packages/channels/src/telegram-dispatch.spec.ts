import { describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from './telegram.js';

type Update = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text: string;
    from: { id: number };
  };
  callback_query?: { id: string };
};

function channelWithHandler(handle: (update: Update) => Promise<void>) {
  const channel = new TelegramChannel({
    botToken: 't',
    sessionBridge: {} as never,
    sessions: {} as never,
  } as never);
  vi.spyOn(
    channel as unknown as { handleUpdate: (u: Update) => Promise<void> },
    'handleUpdate',
  ).mockImplementation(handle);
  return channel as unknown as { dispatchUpdate: (u: Update) => void };
}

const msg = (id: number, chat: number): Update => ({
  update_id: id,
  message: {
    message_id: id,
    chat: { id: chat, type: 'private' },
    text: `m${id}`,
    from: { id: chat },
  },
});

describe('TelegramChannel update dispatch (CQ-007)', () => {
  it('does not let a slow turn in one chat block another chat', async () => {
    const handled: number[] = [];
    let releaseA!: () => void;
    const channel = channelWithHandler(async (u) => {
      if (u.update_id === 1) await new Promise<void>((resolve) => (releaseA = resolve));
      handled.push(u.update_id);
    });
    channel.dispatchUpdate(msg(1, 100));
    channel.dispatchUpdate(msg(2, 200));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handled).toEqual([2]);
    releaseA();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handled).toEqual([2, 1]);
  });

  it('keeps messages from one chat in order', async () => {
    const handled: number[] = [];
    const channel = channelWithHandler(async (u) => {
      await new Promise((resolve) => setTimeout(resolve, u.update_id === 1 ? 20 : 0));
      handled.push(u.update_id);
    });
    channel.dispatchUpdate(msg(1, 100));
    channel.dispatchUpdate(msg(2, 100));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handled).toEqual([1, 2]);
  });

  it('handles approval button callbacks immediately, even while the chat is busy', async () => {
    const handled: string[] = [];
    let release!: () => void;
    const channel = channelWithHandler(async (u) => {
      if (u.message) await new Promise<void>((resolve) => (release = resolve));
      handled.push(u.message ? 'message' : 'callback');
    });
    channel.dispatchUpdate(msg(1, 100));
    channel.dispatchUpdate({ update_id: 2, callback_query: { id: 'cb' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handled).toEqual(['callback']);
    release();
  });

  it('logs a failing update without affecting the next one', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handled: number[] = [];
    const channel = channelWithHandler(async (u) => {
      if (u.update_id === 1) throw new Error('bad update');
      handled.push(u.update_id);
    });
    channel.dispatchUpdate(msg(1, 100));
    channel.dispatchUpdate(msg(2, 100));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handled).toEqual([2]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
