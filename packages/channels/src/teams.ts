import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface TeamsChannelOptions extends WebhookChannelOptions {
  appId?: string;
  appPassword?: string;
  serviceUrl?: string;
}

/** Microsoft Teams adapter — Bot Framework webhook delivery when configured. */
export class TeamsChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'teams';

  constructor(private readonly teamsOptions: TeamsChannelOptions) {
    super(teamsOptions);
  }

  isConfigured(): boolean {
    return Boolean(
      this.teamsOptions.appId &&
        this.teamsOptions.appPassword &&
        this.teamsOptions.serviceUrl,
    );
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.isConfigured() || !message.content) return;

    const session = await this.options.sessions.get(sessionId);
    const conversationId = (session?.metadata?.teams as { conversationId?: string } | undefined)
      ?.conversationId;
    if (!conversationId) return;

    const tokenRes = await fetch(
      'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.teamsOptions.appId!,
          client_secret: this.teamsOptions.appPassword!,
          scope: 'https://api.botframework.com/.default',
        }),
      },
    );
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return;

    await fetch(
      `${this.teamsOptions.serviceUrl}/v3/conversations/${conversationId}/activities`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'message', text: message.content }),
      },
    );
  }
}
