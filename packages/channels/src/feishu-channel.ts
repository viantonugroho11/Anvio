import type { ChannelType, OutboundMessage } from '@anvio/core';
import { fetchWithRetry } from './fetch-retry.js';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface FeishuChannelOptions extends WebhookChannelOptions {
  webhookUrl?: string;
}

/** Feishu/Lark bot webhook adapter. */
export class FeishuChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'feishu';

  constructor(private readonly feishuOptions: FeishuChannelOptions) {
    super(feishuOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.feishuOptions.webhookUrl);
  }

  async handleWebhookMessage(input: {
    senderId: string;
    text: string;
  }): Promise<{ sessionId: string; userId: string }> {
    const userId = `feishu:${input.senderId}`;
    const threadId = `feishu:${input.senderId}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'feishu',
      threadId,
      userId,
      this.feishuOptions.defaultAgent,
    );
    await this.handleInbound(session.id, userId, input.text, 'feishu');
    return { sessionId: session.id, userId };
  }

  protected async deliverMessage(_sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    await fetchWithRetry(this.feishuOptions.webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: message.content },
      }),
    });
  }
}
