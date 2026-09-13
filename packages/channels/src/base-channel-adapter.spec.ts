import { describe, expect, it } from 'vitest';
import type { ApprovalRequestMessage, ChannelType, OutboundMessage } from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';

class TestAdapter extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'telegram';
  protected readonly maxMessageLength: number;
  protected readonly isLiveChatSurface: boolean;
  protected readonly supportsNativeTyping: boolean;
  protected readonly typingRefreshMs: number;
  readonly sent: string[] = [];
  readonly typingSignals: string[] = [];

  constructor(
    maxMessageLength = 0,
    options: { live?: boolean; nativeTyping?: boolean; refreshMs?: number } = {},
  ) {
    super();
    this.maxMessageLength = maxMessageLength;
    this.isLiveChatSurface = options.live ?? false;
    this.supportsNativeTyping = options.nativeTyping ?? false;
    this.typingRefreshMs = options.refreshMs ?? 0;
  }

  protected async sendTypingSignal(sessionId: string): Promise<void> {
    this.typingSignals.push(sessionId);
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const text = this.resolveOutboundText(sessionId, message);
    if (!text) return;
    for (const chunk of this.chunkForDelivery(text)) this.sent.push(chunk);
  }

  protected async sendApprovalRequestWithActions(
    _sessionId: string,
    _request: ApprovalRequestMessage,
  ): Promise<void> {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.releaseAllBuffers();
  }

  /** Test-only window onto the buffer, which is private by design. */
  buffered(sessionId: string): string | null {
    return this.resolveOutboundText(sessionId, { sessionId, type: 'done' });
  }
}

function chunk(sessionId: string, delta: string): OutboundMessage {
  return { sessionId, type: 'chunk', delta };
}

describe('BaseChannelAdapter buffering', () => {
  it('accumulates deltas and delivers them on done', async () => {
    const adapter = new TestAdapter();

    await adapter.sendMessage('s1', chunk('s1', 'Hello '));
    await adapter.sendMessage('s1', chunk('s1', 'world'));
    expect(adapter.sent).toEqual([]);

    await adapter.sendMessage('s1', { sessionId: 's1', type: 'done' });
    expect(adapter.sent).toEqual(['Hello world']);
  });

  it('prefers explicit content over the buffer on done', async () => {
    const adapter = new TestAdapter();

    await adapter.sendMessage('s1', chunk('s1', 'partial'));
    await adapter.sendMessage('s1', { sessionId: 's1', type: 'done', content: 'final' });

    expect(adapter.sent).toEqual(['final']);
    expect(adapter.buffered('s1')).toBeNull();
  });

  it('releases the buffer when a turn fails (issue #73)', async () => {
    const adapter = new TestAdapter();

    await adapter.sendMessage('s1', chunk('s1', 'half an answer'));
    // A failed run sends a task_failed notification and never a `done`.
    await adapter.sendNotification('s1', {
      sessionId: 's1',
      type: 'task_failed',
      title: 'Task Failed',
      body: 'boom',
    });

    expect(adapter.buffered('s1')).toBeNull();
  });

  it('keeps buffers isolated per session', async () => {
    const adapter = new TestAdapter();

    await adapter.sendMessage('s1', chunk('s1', 'one'));
    await adapter.sendMessage('s2', chunk('s2', 'two'));
    await adapter.sendMessage('s1', { sessionId: 's1', type: 'done' });

    expect(adapter.sent).toEqual(['one']);
    expect(adapter.buffered('s2')).toBe('two');
  });

  it('drops every buffer on stop()', async () => {
    const adapter = new TestAdapter();

    await adapter.sendMessage('s1', chunk('s1', 'stranded'));
    await adapter.stop();

    expect(adapter.buffered('s1')).toBeNull();
  });
});

describe('BaseChannelAdapter chunking', () => {
  it('splits to the declared limit (issue #74)', async () => {
    const adapter = new TestAdapter(10);

    await adapter.sendMessage('s1', {
      sessionId: 's1',
      type: 'done',
      content: 'alpha\nbravo\ncharlie\ndelta',
    });

    expect(adapter.sent.length).toBeGreaterThan(1);
    for (const part of adapter.sent) expect(part.length).toBeLessThanOrEqual(10);
  });

  it('sends in one piece when no limit is declared', async () => {
    const adapter = new TestAdapter();
    const long = 'x'.repeat(50_000);

    await adapter.sendMessage('s1', { sessionId: 's1', type: 'done', content: long });

    expect(adapter.sent).toEqual([long]);
  });
});

describe('BaseChannelAdapter progress (issue #76)', () => {
  const running = { sessionId: 's1', phase: 'Calling model', status: 'running' as const };

  it('uses the native indicator when the channel has one', async () => {
    const adapter = new TestAdapter(0, { live: true, nativeTyping: true });

    await adapter.sendProgress('s1', running);

    expect(adapter.typingSignals).toEqual(['s1']);
    expect(adapter.sent).toEqual([]);
  });

  it('stays silent on a live chat surface with no native indicator', async () => {
    const adapter = new TestAdapter(0, { live: true, nativeTyping: false });

    await adapter.sendProgress('s1', running);

    // A bubble per phase buried the reply on these surfaces (issue #54(a)).
    expect(adapter.sent).toEqual([]);
    expect(adapter.typingSignals).toEqual([]);
  });

  it('keeps the text fallback for non-chat surfaces', async () => {
    const adapter = new TestAdapter(0, { live: false, nativeTyping: false });

    await adapter.sendProgress('s1', running);

    // Email, SMS and webhooks have no live view to express progress in.
    expect(adapter.sent).toEqual(['🔄 Calling model']);
  });

  it('clears the indicator when the phase completes', async () => {
    const adapter = new TestAdapter(0, { live: true, nativeTyping: true });

    await adapter.sendProgress('s1', running);
    await adapter.sendProgress('s1', { ...running, status: 'completed' });
    await adapter.sendProgress('s1', running);

    // Cleared, so a fresh phase starts a new indicator rather than deduping.
    expect(adapter.typingSignals).toEqual(['s1', 's1']);
  });

  it('does not start a second keepalive for the same session', async () => {
    const adapter = new TestAdapter(0, { live: true, nativeTyping: true });

    await adapter.setTyping('s1', true);
    await adapter.setTyping('s1', true);

    expect(adapter.typingSignals).toEqual(['s1']);
  });

  it('ignores setTyping entirely when the channel has no indicator', async () => {
    const adapter = new TestAdapter(0, { live: true, nativeTyping: false });

    await adapter.setTyping('s1', true);

    expect(adapter.typingSignals).toEqual([]);
  });
});
