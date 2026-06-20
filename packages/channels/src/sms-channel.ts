import type { ChannelType, OutboundMessage } from '@anvio/core';
import { fetchWithRetry } from './fetch-retry.js';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface SmsChannelOptions extends WebhookChannelOptions {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

/** SMS adapter — Twilio REST outbound when configured. */
export class SmsChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'sms';

  constructor(private readonly smsOptions: SmsChannelOptions) {
    super(smsOptions);
  }

  isConfigured(): boolean {
    return Boolean(
      this.smsOptions.accountSid && this.smsOptions.authToken && this.smsOptions.fromNumber,
    );
  }

  async handleInboundSms(input: {
    from: string;
    body: string;
  }): Promise<{ sessionId: string; userId: string }> {
    const userId = `sms:${input.from}`;
    const threadId = `sms:${input.from}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'sms',
      threadId,
      userId,
      this.smsOptions.defaultAgent,
    );
    await this.options.sessions.update(session.id, {
      metadata: { ...session.metadata, sms: { from: input.from } },
    });
    await this.handleInbound(session.id, userId, input.body, 'sms');
    return { sessionId: session.id, userId };
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    const session = await this.options.sessions.get(sessionId);
    const to =
      (session?.metadata?.sms as { from?: string } | undefined)?.from ??
      (session?.channelThread?.threadId?.replace(/^sms:/, '') ?? '');
    if (!to) return;

    const sid = this.smsOptions.accountSid!;
    const auth = Buffer.from(`${sid}:${this.smsOptions.authToken!}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

    await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: this.smsOptions.fromNumber!,
        To: to,
        Body: message.content,
      }),
    });
  }
}
