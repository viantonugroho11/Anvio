import type {
  AgentNotification,
  ApprovalRequestMessage,
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  InboundMessageHandler,
  OutboundMessage,
  ProgressUpdate,
} from '@anvio/core';
import { fetchWithRetry, type FetchRetryOptions } from './fetch-retry.js';
import { splitMessage } from './split-message.js';

/**
 * Notifications that end a turn. Reaching one means no `done` is coming, so
 * whatever was buffered for that session will never be delivered and has to
 * be released here (issue #73).
 */
const TERMINAL_NOTIFICATIONS = new Set(['task_failed', 'task_completed']);

export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly channelType: ChannelType;
  protected handler: InboundMessageHandler | null = null;

  /**
   * Per-message character limit for this channel; 0 means unlimited. Declared
   * rather than coded, so each adapter states its platform's limit and gets
   * the shared splitter's behaviour for free (issue #76). Slack and
   * Mattermost had no chunking at all, and an over-limit reply aborted the
   * run (issue #74).
   */
  protected readonly maxMessageLength: number = 0;

  /**
   * Streamed deltas awaiting a `done`. Five adapters each kept their own
   * identical copy of this map and all five leaked it on a failed turn.
   */
  private readonly streamBuffer = new Map<string, string>();

  /**
   * True when a human watches messages arrive here in real time. On such a
   * surface a progress bubble per phase buries the actual reply (issue
   * #54(a)), so progress is expressed as a native indicator or not at all;
   * the text fallback is kept for email, SMS and webhooks, which have no
   * live view to express it in.
   */
  protected readonly isLiveChatSurface: boolean = false;

  /** Whether this channel has a native busy indicator at all. */
  protected readonly supportsNativeTyping: boolean = false;

  /**
   * How often the native indicator must be re-sent to stay visible; 0 for a
   * one-shot call that the platform keeps alive itself. Telegram expires a
   * chat action after ~5s and Discord after 10s, whereas WhatsApp holds one
   * for 25s or until the reply lands.
   */
  protected readonly typingRefreshMs: number = 0;

  /** Sessions currently showing the indicator, with their keepalive if any. */
  private readonly typingSessions = new Map<string, ReturnType<typeof setInterval> | null>();

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  protected async dispatchInbound(message: InboundMessage): Promise<void> {
    if (this.handler) await this.handler(message);
  }

  abstract sendMessage(sessionId: string, message: OutboundMessage): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  /**
   * Outbound HTTP for adapters, with 429/5xx backoff that honours the
   * server's own `Retry-After`. Retry is opt-out here rather than opt-in:
   * the adapters that actually meet rate limits were precisely the ones
   * calling bare `fetch` (issue #75).
   */
  protected httpRequest(
    url: string,
    init?: RequestInit,
    options?: FetchRetryOptions,
  ): Promise<Response> {
    return fetchWithRetry(url, init, options);
  }

  /**
   * Resolve the text an outbound message should deliver, owning the buffer's
   * whole lifecycle. Returns `null` when there is nothing to send — either
   * the delta was buffered, or the message carries no text.
   */
  protected resolveOutboundText(sessionId: string, message: OutboundMessage): string | null {
    if (message.type === 'chunk' && message.delta) {
      this.streamBuffer.set(sessionId, (this.streamBuffer.get(sessionId) ?? '') + message.delta);
      return null;
    }

    let text = message.content ?? message.delta ?? '';
    if (message.type === 'done' || message.type === 'error') {
      text = message.content ?? this.streamBuffer.get(sessionId) ?? text;
      this.streamBuffer.delete(sessionId);
    }
    return text || null;
  }

  /** Split text to this channel's per-message limit. */
  protected chunkForDelivery(text: string): string[] {
    return this.maxMessageLength > 0 ? splitMessage(text, this.maxMessageLength) : [text];
  }

  protected releaseBuffer(sessionId: string): void {
    this.streamBuffer.delete(sessionId);
  }

  /** Release every buffer — adapters call this from `stop()`. */
  protected releaseAllBuffers(): void {
    this.streamBuffer.clear();
    this.clearAllTyping();
  }

  /**
   * One native "busy" call for this session. Adapters with an indicator
   * override it; the base keeps the lifecycle so no adapter has to
   * reimplement the keepalive and its cleanup.
   */
  protected async sendTypingSignal(_sessionId: string): Promise<void> {}

  async setTyping(sessionId: string, active: boolean): Promise<void> {
    if (!this.supportsNativeTyping) return;

    if (!active) {
      const timer = this.typingSessions.get(sessionId);
      if (timer) clearInterval(timer);
      this.typingSessions.delete(sessionId);
      return;
    }
    if (this.typingSessions.has(sessionId)) return;

    // Claim the slot before the first await, so two deltas arriving back to
    // back cannot each start their own keepalive and orphan one.
    let timer: ReturnType<typeof setInterval> | null = null;
    if (this.typingRefreshMs > 0) {
      timer = setInterval(() => void this.safeTypingSignal(sessionId), this.typingRefreshMs);
      timer.unref?.();
    }
    this.typingSessions.set(sessionId, timer);
    await this.safeTypingSignal(sessionId);
  }

  /** The indicator is cosmetic — never fail a turn over it. */
  private async safeTypingSignal(sessionId: string): Promise<void> {
    try {
      await this.sendTypingSignal(sessionId);
    } catch (error) {
      console.error(
        `[${this.channelType}] typing indicator failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Stop every indicator — adapters call this from `stop()`. */
  protected clearAllTyping(): void {
    for (const timer of this.typingSessions.values()) if (timer) clearInterval(timer);
    this.typingSessions.clear();
  }

  async sendProgress(sessionId: string, update: ProgressUpdate): Promise<void> {
    if (this.supportsNativeTyping) {
      await this.setTyping(sessionId, update.status === 'running');
      return;
    }
    // A live chat surface with no native indicator says nothing rather than
    // posting a bubble per phase.
    if (this.isLiveChatSurface) return;

    const emoji = update.emoji ?? (update.status === 'completed' ? '✅' : '🔄');
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `${emoji} ${update.phase}`,
      metadata: { progress: update },
    });
  }

  async sendNotification(sessionId: string, notification: AgentNotification): Promise<void> {
    // A failed turn never sends `done`, so this is the last chance to let the
    // buffered partial go.
    if (TERMINAL_NOTIFICATIONS.has(notification.type)) this.releaseBuffer(sessionId);

    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `*${notification.title}*${notification.body ? `\n${notification.body}` : ''}`,
      metadata: { notification },
    });
  }

  async sendApprovalRequest(sessionId: string, request: ApprovalRequestMessage): Promise<void> {
    await this.sendApprovalRequestWithActions(sessionId, request);
  }

  protected abstract sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void>;
}
