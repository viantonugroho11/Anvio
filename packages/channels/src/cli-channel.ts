import type {
  ChannelAdapter,
  ChannelType,
  InboundMessageHandler,
  OutboundMessage,
} from '@anvio/core';

export interface CliChannelSink {
  onChunk?(sessionId: string, delta: string): void;
  onMessage?(sessionId: string, content: string): void;
  onProgress?(sessionId: string, phase: string, emoji: string): void;
  onNotification?(sessionId: string, title: string, body?: string): void;
}

/** CLI channel — stdout/stderr transport for Command Center. */
export class CliChannel implements ChannelAdapter {
  readonly channelType: ChannelType = 'cli';
  private handler: InboundMessageHandler | null = null;
  private sink: CliChannelSink = {};

  setSink(sink: CliChannelSink): void {
    this.sink = sink;
  }

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  async handleInbound(
    sessionId: string,
    userId: string,
    content: string,
  ): Promise<void> {
    if (!this.handler) return;
    await this.handler({ sessionId, userId, content, channel: 'cli' });
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (message.type === 'chunk' && message.delta) {
      this.sink.onChunk?.(sessionId, message.delta);
      return;
    }
    if (message.content) {
      this.sink.onMessage?.(sessionId, message.content);
    }
  }

  async sendProgress(
    sessionId: string,
    update: { phase: string; emoji?: string },
  ): Promise<void> {
    const emoji = update.emoji ?? '🔄';
    this.sink.onProgress?.(sessionId, update.phase, emoji);
    process.stdout.write(`${emoji} ${update.phase}\n`);
  }

  async sendNotification(
    sessionId: string,
    notification: { title: string; body?: string },
  ): Promise<void> {
    this.sink.onNotification?.(sessionId, notification.title, notification.body);
    console.log(`\n📣 ${notification.title}${notification.body ? `: ${notification.body}` : ''}`);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
