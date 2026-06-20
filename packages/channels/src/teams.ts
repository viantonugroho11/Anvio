import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface TeamsActivity {
  type?: string;
  text?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string };
  conversation?: { id?: string };
  channelData?: { tenant?: { id?: string } };
}

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

  /** Handle Bot Framework activity webhook payload. */
  async handleActivity(activity: TeamsActivity): Promise<{ sessionId: string; userId: string } | null> {
    if (activity.type !== 'message' || !activity.text?.trim()) return null;

    const userId = activity.from?.id ? `teams:${activity.from.id}` : 'teams:unknown';
    const conversationId = activity.conversation?.id;
    if (!conversationId) return null;

    const threadId = `teams:${conversationId}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'teams',
      threadId,
      this.teamsOptions.defaultAgent,
    );

    await this.options.sessions.update(session.id, {
      metadata: {
        ...session.metadata,
        teams: {
          conversationId,
          serviceUrl: activity.serviceUrl ?? this.teamsOptions.serviceUrl,
          userId: activity.from?.id,
        },
      },
    });

    await this.handleInbound(session.id, userId, activity.text.trim(), 'teams');
    return { sessionId: session.id, userId };
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!message.content) return;

    const session = await this.options.sessions.get(sessionId);
    const teamsMeta = session?.metadata?.teams as
      | { conversationId?: string; serviceUrl?: string }
      | undefined;
    const conversationId = teamsMeta?.conversationId;
    const serviceUrl = teamsMeta?.serviceUrl ?? this.teamsOptions.serviceUrl;

    if (!this.teamsOptions.appId || !this.teamsOptions.appPassword || !serviceUrl || !conversationId) {
      return;
    }

    const tokenRes = await fetch(
      'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.teamsOptions.appId,
          client_secret: this.teamsOptions.appPassword,
          scope: 'https://api.botframework.com/.default',
        }),
      },
    );
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return;

    await fetch(`${serviceUrl.replace(/\/$/, '')}/v3/conversations/${conversationId}/activities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'message', text: message.content }),
    });
  }
}
