import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  SessionStore,
} from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';

export interface SlackChannelOptions {
  botToken: string;
  appToken: string;
  sessionBridge: ChannelSessionBridge;
  sessions: SessionStore;
  defaultAgent?: string;
  onApproval?: (
    sessionId: string,
    requestId: string,
    approved: boolean,
    userId?: string,
  ) => Promise<import('@anvio/core').ApprovalResolveOutcome>;
}

interface SlackTarget {
  channelId: string;
  threadTs?: string;
}

interface SlackSocketEnvelope {
  type: string;
  envelope_id?: string;
  payload?: {
    type?: string;
    event?: SlackMessageEvent;
    actions?: Array<{ action_id: string }>;
    channel?: { id: string };
    message?: { thread_ts?: string; ts?: string };
    user?: { id?: string };
  };
}

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  bot_id?: string;
  channel_type?: string;
}

/**
 * Facts for the harness engagement gate (ADR 0032): did this message mention the bot,
 * and did it mention anyone else? The adapter reports; the harness decides.
 */
export function detectSlackMentions(
  text: string,
  botUserId: string | undefined,
): { mentionedBot: boolean; mentionedOther: boolean } {
  // Without our own id we cannot tell the bot apart from other users; report nothing
  // rather than risk a bot mention being read as mention_other and disengaging.
  if (!botUserId) return { mentionedBot: false, mentionedOther: false };
  const ids = [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
  return { mentionedBot: ids.includes(botUserId), mentionedOther: ids.some((id) => id !== botUserId) };
}

const SLACK_API = 'https://slack.com/api';

function threadKey(channelId: string, threadTs?: string): string {
  return threadTs ? `channel:${channelId}:thread:${threadTs}` : `channel:${channelId}`;
}

function parseSlackTarget(session: {
  channelThread?: { threadId: string };
  metadata?: Record<string, unknown>;
}): SlackTarget | null {
  const meta = session.metadata?.slack as SlackTarget | undefined;
  if (meta?.channelId) return meta;

  const threadId = session.channelThread?.threadId;
  if (!threadId) return null;
  const threaded = threadId.match(/^channel:([^:]+):thread:(.+)$/);
  if (threaded) {
    return { channelId: threaded[1]!, threadTs: threaded[2] };
  }
  const plain = threadId.match(/^channel:(.+)$/);
  if (plain) return { channelId: plain[1]! };
  return null;
}

export class SlackChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'slack';
  private ws: WebSocket | null = null;
  private botUserId: Promise<string | undefined> | null = null;
  /** chat.postMessage rejects anything past 40,000 chars with msg_too_long. */
  protected readonly maxMessageLength = 40_000;
  /**
   * Slack has no typing indicator a normal bot can send. `users.setPresence`
   * is unrelated, and `assistant.threads.setStatus` only accepts assistant
   * threads — it rejects a regular channel outright and is itself being
   * migrated to `agents.sessions.setStatus`. So progress on Slack is silent
   * rather than a bubble per phase (issue #76).
   */
  protected readonly isLiveChatSurface = true;

  constructor(private readonly options: SlackChannelOptions) {
    super();
  }

  private async slackApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.httpRequest(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!json.ok) throw new Error(`Slack API ${method}: ${json.error ?? 'unknown'}`);
    return json;
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseSlackTarget(session);
    if (!target) return;

    const text = this.resolveOutboundText(sessionId, message);
    if (!text) return;

    // Slack had no chunking at all, so an over-limit reply threw and took the
    // whole run with it (issue #74).
    for (const chunk of this.chunkForDelivery(text)) {
      await this.slackApi('chat.postMessage', {
        channel: target.channelId,
        thread_ts: target.threadTs,
        text: chunk,
      });
    }
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseSlackTarget(session);
    if (!target) return;

    await this.slackApi('chat.postMessage', {
      channel: target.channelId,
      thread_ts: target.threadTs,
      text: `⚠️ Approval required: *${request.toolName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Approval required*\nTool: \`${request.toolName}\`\n${request.reason}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `approve:${request.requestId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: `reject:${request.requestId}`,
            },
          ],
        },
      ],
    });
  }

  async start(): Promise<void> {
    const url = `wss://wss-primary.slack.com/link/?app_token=${this.options.appToken}`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => void this.handleSocketMessage(String(ev.data));
    this.ws.onclose = () => {
      console.log('[Slack] Socket Mode disconnected, reconnecting in 5s…');
      setTimeout(() => void this.start(), 5000);
    };
    console.log('[Slack] Socket Mode connecting');
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.releaseAllBuffers();
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    const envelope = JSON.parse(raw) as SlackSocketEnvelope;

    if (envelope.type === 'hello') return;

    if (envelope.envelope_id) {
      this.ws?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }

    if (envelope.type === 'events_api' && envelope.payload) {
      if (envelope.payload.type === 'block_actions') {
        await this.handleBlockActions(envelope.payload);
        return;
      }
      const event = envelope.payload.event;
      if (event?.type === 'message') {
        await this.handleMessage(event);
      }
    }
  }

  /** Bot's own Slack user id via auth.test, cached; undefined if the call fails. */
  private resolveBotUserId(): Promise<string | undefined> {
    this.botUserId ??= this.slackApi<{ ok: boolean; user_id?: string }>('auth.test', {})
      .then((res) => (res.ok ? res.user_id : undefined))
      .catch(() => undefined);
    return this.botUserId;
  }

  private async handleMessage(event: SlackMessageEvent): Promise<void> {
    if (event.subtype || event.bot_id || !event.text || !event.user) return;

    const threadId = threadKey(event.channel, event.thread_ts);
    const userId = `slack:${event.user}`;

    const session = await this.options.sessionBridge.resolveOrCreate(
      'slack',
      threadId,
      userId,
      this.options.defaultAgent,
    );

    if (!session.metadata?.slack) {
      await this.options.sessions.update(session.id, {
        metadata: {
          ...session.metadata,
          slack: { channelId: event.channel, threadTs: event.thread_ts },
        },
      });
    }

    const normalized = event.text.trim().toLowerCase();
    if (normalized === 'approve' || normalized === 'reject') {
      const pending = session.pendingApproval;
      if (pending && this.options.onApproval) {
        await this.options.onApproval(session.id, pending.id, normalized === 'approve');
        return;
      }
    }

    const isDm = event.channel_type === 'im' || event.channel.startsWith('D');
    const mentions = detectSlackMentions(event.text, await this.resolveBotUserId());

    await this.dispatchInbound({
      sessionId: session.id,
      userId,
      content: event.text,
      channel: 'slack',
      channelThreadId: threadId,
      metadata: { isDm, ...mentions },
    });
  }

  private async handleBlockActions(
    payload: NonNullable<SlackSocketEnvelope['payload']>,
  ): Promise<void> {
    const action = payload.actions?.[0];
    if (!action?.action_id || !this.options.onApproval) return;

    const [verb, requestId] = action.action_id.split(':');
    if (!requestId) return;

    const channelId = payload.channel?.id;
    if (!channelId) return;

    const threadId = threadKey(channelId, payload.message?.thread_ts);
    const session = await this.options.sessionBridge.resolveOrCreate('slack', threadId);
    const slackUser = payload.user?.id ? `slack:${payload.user.id}` : undefined;
    await this.options.onApproval(session.id, requestId, verb === 'approve', slackUser);
  }
}
