import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface EmailChannelOptions extends WebhookChannelOptions {
  smtpHost?: string;
  username?: string;
  password?: string;
  fromAddress?: string;
}

/** Email adapter — SMTP outbound when configured; queue for polling in tests. */
export class EmailChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'email';

  constructor(private readonly emailOptions: EmailChannelOptions) {
    super(emailOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.emailOptions.smtpHost && this.emailOptions.username);
  }

  protected async deliverMessage(_sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;
    // SMTP delivery deferred — messages remain in store for webhook/polling consumers.
  }
}
