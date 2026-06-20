import type { ChannelType, OutboundMessage } from '@anvio/core';
import { fetchWithRetry } from './fetch-retry.js';
import { getGoogleChatAccessToken, loadGoogleServiceAccount } from './google-chat-auth.js';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface GoogleChatChannelOptions extends WebhookChannelOptions {
  webhookUrl?: string;
  serviceAccountPath?: string;
  /** Google Chat space resource, e.g. spaces/AAAA... */
  space?: string;
}

/** Google Chat adapter — webhook or service account REST delivery. */
export class GoogleChatChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'google-chat';

  constructor(private readonly chatOptions: GoogleChatChannelOptions) {
    super(chatOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.chatOptions.webhookUrl || this.chatOptions.serviceAccountPath);
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!message.content) return;

    if (this.chatOptions.webhookUrl) {
      await fetchWithRetry(this.chatOptions.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.content }),
      });
      return;
    }

    if (!this.chatOptions.serviceAccountPath) return;

    const session = await this.options.sessions.get(sessionId);
    const space =
      this.chatOptions.space ??
      (session?.metadata?.googleChat as { space?: string } | undefined)?.space;
    if (!space) return;

    const sa = await loadGoogleServiceAccount(this.chatOptions.serviceAccountPath);
    const token = await getGoogleChatAccessToken(sa);
    const spacePath = space.startsWith('spaces/') ? space : `spaces/${space}`;

    await fetchWithRetry(`https://chat.googleapis.com/v1/${spacePath}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: message.content }),
    });
  }
}
