import type {
  ChannelAdapter,
  ChannelType,
  InboundMessageHandler,
  OutboundMessage,
} from '@anvio/core';

export type RestMessageHandler = (sessionId: string, message: OutboundMessage) => void;

/** REST API channel — outbound messages exposed via polling or webhook callbacks. */
export class RestApiChannel implements ChannelAdapter {
  readonly channelType: ChannelType = 'rest';
  private handler: InboundMessageHandler | null = null;
  private readonly outbound = new Map<string, OutboundMessage[]>();
  private listeners = new Set<RestMessageHandler>();

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  onOutbound(handler: RestMessageHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getPendingMessages(sessionId: string): OutboundMessage[] {
    return this.outbound.get(sessionId) ?? [];
  }

  async handleInbound(
    sessionId: string,
    userId: string,
    content: string,
  ): Promise<void> {
    if (!this.handler) return;
    await this.handler({
      sessionId,
      userId,
      content,
      channel: 'rest',
    });
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const queue = this.outbound.get(sessionId) ?? [];
    queue.push(message);
    this.outbound.set(sessionId, queue);
    for (const listener of this.listeners) {
      listener(sessionId, message);
    }
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.outbound.clear();
    this.listeners.clear();
  }
}
