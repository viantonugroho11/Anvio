import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface SignalChannelOptions extends WebhookChannelOptions {
  signalCliPath?: string;
  phoneNumber?: string;
}

/** Signal adapter — signal-cli REST bridge when configured. */
export class SignalChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'signal';

  constructor(private readonly signalOptions: SignalChannelOptions) {
    super(signalOptions);
  }

  isConfigured(): boolean {
    const restUrl = process.env.SIGNAL_CLI_REST_URL;
    const hasRest = Boolean(restUrl && this.signalOptions.phoneNumber);
    const hasCli = Boolean(this.signalOptions.signalCliPath && this.signalOptions.phoneNumber);
    return hasRest || hasCli;
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    const restUrl = process.env.SIGNAL_CLI_REST_URL;
    if (!restUrl) return;

    const stored = await this.options.sessions.get(sessionId);
    const recipient =
      stored?.channelThread?.threadId ??
      (typeof stored?.metadata?.signalRecipient === 'string' ? stored.metadata.signalRecipient : undefined);
    if (!recipient) return;

    const base = restUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.content,
        number: this.signalOptions.phoneNumber,
        recipients: [recipient],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Signal REST send failed (${response.status}): ${body.slice(0, 200)}`);
    }
  }
}
