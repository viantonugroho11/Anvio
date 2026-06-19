import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  InboundMessageHandler,
  OutboundMessage,
} from '@anvio/core';

export interface WebChatClient {
  sessionId: string;
  send: (data: string) => void;
}

export class WebChatChannel implements ChannelAdapter {
  readonly channelType: ChannelType = 'web-chat';
  private handler: InboundMessageHandler | null = null;
  private clients = new Map<string, WebChatClient>();

  registerClient(sessionId: string, client: WebChatClient): void {
    this.clients.set(sessionId, client);
  }

  unregisterClient(sessionId: string): void {
    this.clients.delete(sessionId);
  }

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const client = this.clients.get(sessionId);
    if (!client) return;
    client.send(JSON.stringify(message));
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    if (this.handler) await this.handler(message);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.clients.clear();
  }
}

export type { InboundMessage, OutboundMessage };
