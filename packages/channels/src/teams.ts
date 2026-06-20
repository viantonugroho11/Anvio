import { fetchWithRetry } from './fetch-retry.js';
import type { ApprovalRequestMessage, ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';

export interface TeamsActivity {
  type?: string;
  text?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string };
  conversation?: { id?: string };
  channelData?: { tenant?: { id?: string } };
  value?: {
    action?: string;
    requestId?: string;
  };
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
    if (activity.type === 'invoke') {
      await this.handleInvokeActivity(activity);
      return null;
    }

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

  /** Handle Adaptive Card Action.Submit invoke for approval buttons. */
  async handleInvokeActivity(activity: TeamsActivity): Promise<void> {
    const value = activity.value;
    if (!value?.requestId || !value.action) return;

    const conversationId = activity.conversation?.id;
    if (!conversationId) return;

    const threadId = `teams:${conversationId}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'teams',
      threadId,
      this.teamsOptions.defaultAgent,
    );

    const approved = value.action === 'approve';
    if (this.options.onApproval) {
      await this.options.onApproval(
        session.id,
        value.requestId,
        approved,
        activity.from?.id ? `teams:${activity.from.id}` : undefined,
      );
    }
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    const teamsMeta = session?.metadata?.teams as
      | { conversationId?: string; serviceUrl?: string }
      | undefined;
    const conversationId = teamsMeta?.conversationId;
    const serviceUrl = teamsMeta?.serviceUrl ?? this.teamsOptions.serviceUrl;

    if (!this.teamsOptions.appId || !this.teamsOptions.appPassword || !serviceUrl || !conversationId) {
      await super.sendApprovalRequestWithActions(sessionId, request);
      return;
    }

    this.store.pushApproval(sessionId, request);

    const token = await this.fetchBotToken();
    if (!token) {
      await this.sendMessage(sessionId, {
        sessionId,
        type: 'message',
        content: `Approval required: ${request.toolName}\n${request.reason}`,
        metadata: {
          approval: request,
          actions: [
            { id: `approve:${request.requestId}`, label: 'Approve' },
            { id: `reject:${request.requestId}`, label: 'Reject' },
          ],
        },
      });
      return;
    }

    await this.postActivity(serviceUrl, conversationId, token, {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: 'Approval required',
                weight: 'Bolder',
                size: 'Medium',
              },
              {
                type: 'TextBlock',
                text: `Tool: ${request.toolName}`,
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: request.reason,
                wrap: true,
              },
            ],
            actions: [
              {
                type: 'Action.Submit',
                title: 'Approve',
                data: { action: 'approve', requestId: request.requestId },
              },
              {
                type: 'Action.Submit',
                title: 'Reject',
                data: { action: 'reject', requestId: request.requestId },
              },
            ],
          },
        },
      ],
    });
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

    const token = await this.fetchBotToken();
    if (!token) return;

    await this.postActivity(serviceUrl, conversationId, token, {
      type: 'message',
      text: message.content,
    });
  }

  private async fetchBotToken(): Promise<string | null> {
    if (!this.teamsOptions.appId || !this.teamsOptions.appPassword) return null;

    const tokenRes = await fetchWithRetry(
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
    return tokenJson.access_token ?? null;
  }

  private async postActivity(
    serviceUrl: string,
    conversationId: string,
    token: string,
    activity: Record<string, unknown>,
  ): Promise<void> {
    await fetchWithRetry(`${serviceUrl.replace(/\/$/, '')}/v3/conversations/${conversationId}/activities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(activity),
    });
  }
}
