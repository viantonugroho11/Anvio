import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  SessionStore,
} from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';

export interface MattermostChannelOptions {
  serverUrl: string;
  botToken: string;
  sessionBridge: ChannelSessionBridge;
  sessions: SessionStore;
  defaultAgent?: string;
  onApproval?: (sessionId: string, requestId: string, approved: boolean) => Promise<void>;
}

interface MattermostPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  root_id?: string;
}

interface MattermostWebSocketEvent {
  event?: string;
  data?: { post?: string; channel_name?: string };
  broadcast?: { channel_id?: string };
}

function threadKey(channelId: string, rootId?: string): string {
  return rootId ? `channel:${channelId}:thread:${rootId}` : `channel:${channelId}`;
}

export class MattermostChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'mattermost';
  private ws: WebSocket | null = null;
  private botUserId: string | null = null;
  private readonly apiBase: string;
  private readonly wsUrl: string;
  private readonly buffer = new Map<string, string>();

  constructor(private readonly options: MattermostChannelOptions) {
    super();
    const base = options.serverUrl.replace(/\/$/, '');
    this.apiBase = `${base}/api/v4`;
    this.wsUrl = `${base.replace(/^http/, 'ws')}/api/v4/websocket`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.botToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Mattermost ${path}: ${res.status} ${err}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async resolveChannelId(sessionId: string): Promise<string | null> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return null;
    const meta = session.metadata?.mattermost as { channelId?: string; rootId?: string } | undefined;
    if (meta?.channelId) return meta.channelId;
    const threadId = session.channelThread?.threadId;
    if (!threadId) return null;
    const match = threadId.match(/^channel:([^:]+)/);
    return match ? match[1]! : null;
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const meta = session.metadata?.mattermost as { channelId?: string; rootId?: string } | undefined;
    const channelId = meta?.channelId ?? (await this.resolveChannelId(sessionId));
    if (!channelId) return;

    let text = message.content ?? message.delta ?? '';
    if (message.type === 'chunk' && message.delta) {
      this.buffer.set(sessionId, (this.buffer.get(sessionId) ?? '') + message.delta);
      return;
    }
    if (message.type === 'done') {
      text = message.content ?? this.buffer.get(sessionId) ?? text;
      this.buffer.delete(sessionId);
    }
    if (!text) return;

    await this.rest('POST', '/posts', {
      channel_id: channelId,
      message: text,
      root_id: meta?.rootId || undefined,
    });
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `⚠️ **Approval required**\nTool: \`${request.toolName}\`\n${request.reason}\nReply \`approve\` or \`reject\`.`,
    });
  }

  async start(): Promise<void> {
    const me = await this.rest<{ id: string; username?: string }>('GET', '/users/me');
    this.botUserId = me.id;
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('open', () => {
      this.ws?.send(
        JSON.stringify({
          seq: 1,
          action: 'authentication_challenge',
          data: { token: this.options.botToken },
        }),
      );
    });
    this.ws.onmessage = (ev) => void this.handleWebSocketMessage(String(ev.data));
    this.ws.onclose = () => {
      console.log('[Mattermost] WebSocket disconnected, reconnecting in 5s…');
      setTimeout(() => void this.start(), 5000);
    };
    console.log(`[Mattermost] Connected as ${me.username ?? me.id}`);
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }

  private handleWebSocketMessage(raw: string): void {
    const payload = JSON.parse(raw) as MattermostWebSocketEvent & {
      seq_reply?: number;
      status?: string;
    };

    if (payload.seq_reply === 1 && payload.status === 'OK') return;

    if (payload.event === 'posted' && payload.data?.post) {
      void this.handlePosted(payload.data.post);
    }
  }

  private async handlePosted(postJson: string): Promise<void> {
    const post = JSON.parse(postJson) as MattermostPost;
    if (!post.message || post.user_id === this.botUserId) return;

    const threadId = threadKey(post.channel_id, post.root_id);
    const userId = `mattermost:${post.user_id}`;

    const session = await this.options.sessionBridge.resolveOrCreate(
      'mattermost',
      threadId,
      userId,
      this.options.defaultAgent,
    );

    if (!session.metadata?.mattermost) {
      await this.options.sessions.update(session.id, {
        metadata: {
          ...session.metadata,
          mattermost: { channelId: post.channel_id, rootId: post.root_id },
        },
      });
    }

    const normalized = post.message.trim().toLowerCase();
    if (normalized === 'approve' || normalized === 'reject') {
      const pending = session.pendingApproval;
      if (pending && this.options.onApproval) {
        await this.options.onApproval(session.id, pending.id, normalized === 'approve');
        return;
      }
    }

    await this.dispatchInbound({
      sessionId: session.id,
      userId,
      content: post.message,
      channel: 'mattermost',
      channelThreadId: threadId,
    });
  }
}
