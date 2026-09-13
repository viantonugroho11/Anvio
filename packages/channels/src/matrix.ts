import type { ChannelType, OutboundMessage } from '@anvio/core';
import { fetchWithRetry } from './fetch-retry.js';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface MatrixChannelOptions extends WebhookChannelOptions {
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
  roomId?: string;
}

/** Matrix adapter — Client-Server API when configured; in-memory store for tests. */
export class MatrixChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'matrix';
  protected readonly isLiveChatSurface = true;
  /** Typing needs the bot's own user id to address the PUT. */
  protected readonly supportsNativeTyping: boolean;
  /** Refresh inside the timeout declared below. */
  protected readonly typingRefreshMs = 20_000;

  constructor(private readonly matrixOptions: MatrixChannelOptions) {
    super(matrixOptions);
    this.supportsNativeTyping = Boolean(matrixOptions.userId);
  }

  isConfigured(): boolean {
    return Boolean(
      this.matrixOptions.homeserverUrl &&
      this.matrixOptions.accessToken &&
      this.matrixOptions.roomId,
    );
  }

  /** Handle Matrix room message (webhook/sync bridge). */
  async handleRoomMessage(input: {
    roomId: string;
    senderId: string;
    body: string;
  }): Promise<{ sessionId: string; userId: string } | null> {
    if (!input.body.trim()) return null;

    const userId = `matrix:${input.senderId}`;
    const threadId = `matrix:${input.roomId}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'matrix',
      threadId,
      this.matrixOptions.defaultAgent,
    );

    await this.options.sessions.update(session.id, {
      metadata: {
        ...session.metadata,
        matrix: { roomId: input.roomId, senderId: input.senderId },
      },
    });

    await this.handleInbound(session.id, userId, input.body.trim(), 'matrix');
    return { sessionId: session.id, userId };
  }

  private async resolveRoomId(sessionId: string): Promise<string | null> {
    const session = await this.options.sessions.get(sessionId);
    return (
      (session?.metadata?.matrix as { roomId?: string } | undefined)?.roomId ??
      this.matrixOptions.roomId ??
      null
    );
  }

  protected async sendTypingSignal(sessionId: string): Promise<void> {
    if (!this.isConfigured() || !this.matrixOptions.userId) return;
    const roomId = await this.resolveRoomId(sessionId);
    if (!roomId) return;

    const base = this.matrixOptions.homeserverUrl!.replace(/\/$/, '');
    await fetchWithRetry(
      `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(
        this.matrixOptions.userId,
      )}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.matrixOptions.accessToken}`,
          'Content-Type': 'application/json',
        },
        // The server clears the state on its own after `timeout`, so a
        // dropped turn cannot leave the indicator stuck on.
        body: JSON.stringify({ typing: true, timeout: 30_000 }),
      },
    );
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    const session = await this.options.sessions.get(sessionId);
    const roomId =
      (session?.metadata?.matrix as { roomId?: string } | undefined)?.roomId ??
      this.matrixOptions.roomId;
    if (!roomId) return;

    const base = this.matrixOptions.homeserverUrl!.replace(/\/$/, '');
    await fetchWithRetry(
      `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.matrixOptions.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: message.content,
        }),
      },
    );
  }
}
