import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface GoogleChatChannelOptions extends WebhookChannelOptions {
  webhookUrl?: string;
}

/** Google Chat adapter — incoming webhook when configured. */
export class GoogleChatChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'google-chat';

  constructor(private readonly chatOptions: GoogleChatChannelOptions) {
    super(chatOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.chatOptions.webhookUrl);
  }

  protected async deliverMessage(_sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    await fetch(this.chatOptions.webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message.content }),
    });
  }
}
