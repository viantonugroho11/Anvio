import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface SignalChannelOptions extends WebhookChannelOptions {
  signalCliPath?: string;
  phoneNumber?: string;
}

/** Signal adapter — signal-cli bridge when configured. */
export class SignalChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'signal';

  constructor(private readonly signalOptions: SignalChannelOptions) {
    super(signalOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.signalOptions.signalCliPath && this.signalOptions.phoneNumber);
  }

  protected async deliverMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {
    if (!this.isConfigured()) return;
    // signal-cli integration deferred — store captures outbound for tests.
  }
}
