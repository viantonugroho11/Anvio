import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  SessionStore,
} from '@anvio/core';
import type { ChannelVoiceOptions, VoicePipeline } from '@anvio/voice';
import { isChannelVoiceEnabled, transcribeInboundAudio, voiceInboundContent } from '@anvio/voice';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';

export interface DiscordChannelOptions {
  botToken: string;
  sessionBridge: ChannelSessionBridge;
  sessions: SessionStore;
  defaultAgent?: string;
  voice?: ChannelVoiceOptions;
  voicePipeline?: VoicePipeline;
  onApproval?: (
    sessionId: string,
    requestId: string,
    approved: boolean,
    userId?: string,
  ) => Promise<void>;
}

interface DiscordGatewayPayload {
  op: number;
  t?: string;
  s?: number | null;
  d?: unknown;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: { id: string; bot?: boolean };
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    content_type?: string;
  }>;
}

interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: { custom_id?: string };
  channel_id: string;
  member?: { user: { id: string } };
  user?: { id: string };
}

const DISCORD_API = 'https://discord.com/api/v10';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15); // GUILDS + GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT

function threadKey(channelId: string): string {
  return `channel:${channelId}`;
}

export class DiscordChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'discord';
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly buffer = new Map<string, string>();

  constructor(private readonly options: DiscordChannelOptions) {
    super();
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bot ${this.options.botToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Discord API ${path}: ${res.status} ${err}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async resolveChannelId(sessionId: string): Promise<string | null> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return null;
    const meta = session.metadata?.discord as { channelId?: string } | undefined;
    if (meta?.channelId) return meta.channelId;
    const threadId = session.channelThread?.threadId;
    if (!threadId) return null;
    const match = threadId.match(/^channel:(\d+)$/);
    return match ? match[1]! : null;
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const channelId = await this.resolveChannelId(sessionId);
    if (!channelId) return;

    let content = message.content ?? message.delta ?? '';
    if (message.type === 'chunk' && message.delta) {
      const prev = this.buffer.get(sessionId) ?? '';
      this.buffer.set(sessionId, prev + message.delta);
      return;
    }
    if (message.type === 'done') {
      content = message.content ?? this.buffer.get(sessionId) ?? content;
      this.buffer.delete(sessionId);
    }
    if (!content) return;

    const chunks = splitMessage(content, 2000);
    for (const chunk of chunks) {
      await this.rest('POST', `/channels/${channelId}/messages`, { content: chunk });
    }
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const channelId = await this.resolveChannelId(sessionId);
    if (!channelId) return;

    await this.rest('POST', `/channels/${channelId}/messages`, {
      content: `⚠️ **Approval required**\nTool: \`${request.toolName}\`\n${request.reason}`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: 'Approve',
              custom_id: `approve:${request.requestId}`,
            },
            {
              type: 2,
              style: 4,
              label: 'Reject',
              custom_id: `reject:${request.requestId}`,
            },
          ],
        },
      ],
    });
  }

  async start(): Promise<void> {
    const { url } = await this.rest<{ url: string }>('GET', '/gateway/bot');
    this.ws = new WebSocket(`${url}?v=10&encoding=json`);
    this.ws.onmessage = (ev) => void this.handleGatewayMessage(String(ev.data));
    this.ws.onclose = () => {
      console.log('[Discord] Gateway disconnected, reconnecting in 5s…');
      setTimeout(() => void this.start(), 5000);
    };
    console.log('[Discord] Bot gateway connecting');
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
  }

  private async handleGatewayMessage(raw: string): Promise<void> {
    const payload = JSON.parse(raw) as DiscordGatewayPayload;

    switch (payload.op) {
      case 10: {
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
        this.startHeartbeat(interval);
        this.identify();
        break;
      }
      case 0:
        await this.handleDispatch(payload.t, payload.d);
        break;
      case 7:
        this.ws?.close();
        break;
      case 9:
        this.identify();
        break;
      default:
        break;
    }
  }

  private identify(): void {
    this.ws?.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.options.botToken,
          intents: INTENTS,
          properties: {
            os: process.platform,
            browser: 'anvio',
            device: 'anvio',
          },
        },
      }),
    );
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: null }));
    }, intervalMs);
  }

  private async handleDispatch(event: string | undefined, data: unknown): Promise<void> {
    if (event === 'MESSAGE_CREATE') {
      await this.handleMessage(data as DiscordMessage);
    }
    if (event === 'INTERACTION_CREATE') {
      await this.handleInteraction(data as DiscordInteraction);
    }
  }

  private async handleMessage(msg: DiscordMessage): Promise<void> {
    if (msg.author.bot) return;

    const threadId = threadKey(msg.channel_id);
    const userId = `discord:${msg.author.id}`;

    const session = await this.options.sessionBridge.resolveOrCreate(
      'discord',
      threadId,
      userId,
      this.options.defaultAgent,
    );

    if (!session.metadata?.discord) {
      await this.options.sessions.update(session.id, {
        metadata: {
          ...session.metadata,
          discord: { channelId: msg.channel_id },
        },
      });
    }

    const audioAttachment = isChannelVoiceEnabled(this.options)
      ? msg.attachments?.find(isAudioAttachment)
      : undefined;

    if (audioAttachment && this.options.voicePipeline) {
      await this.handleAudioAttachment(session.id, userId, threadId, audioAttachment);
      return;
    }

    if (!msg.content) return;

    const normalized = msg.content.trim().toLowerCase();
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
      content: msg.content,
      channel: 'discord',
      channelThreadId: threadId,
    });
  }

  private async handleAudioAttachment(
    sessionId: string,
    userId: string,
    threadId: string,
    attachment: NonNullable<DiscordMessage['attachments']>[number],
  ): Promise<void> {
    if (!this.options.voicePipeline) return;
    try {
      const res = await fetch(attachment.url, {
        headers: { Authorization: `Bot ${this.options.botToken}` },
      });
      if (!res.ok) throw new Error(`Discord attachment download failed: ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      const mimeType = attachment.content_type ?? guessAudioMime(attachment.filename);
      const transcript = await transcribeInboundAudio(this.options.voicePipeline, audio, mimeType);
      await this.dispatchInbound({
        sessionId,
        userId,
        content: voiceInboundContent(transcript),
        channel: 'discord',
        channelThreadId: threadId,
        metadata: { voice: true, transcript, attachmentId: attachment.id },
      });
    } catch (error) {
      console.error(
        '[Discord] Audio transcribe failed:',
        error instanceof Error ? error.message : error,
      );
      await this.dispatchInbound({
        sessionId,
        userId,
        content: '[voice] (transcription failed)',
        channel: 'discord',
        channelThreadId: threadId,
        metadata: { voice: true, error: true },
      });
    }
  }

  private async interactionCallback(interaction: DiscordInteraction, body: unknown): Promise<void> {
    const res = await fetch(
      `${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Discord interaction callback: ${res.status} ${err}`);
    }
  }

  private async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    if (interaction.type !== 3 || !interaction.data?.custom_id) return;
    const [action, requestId] = interaction.data.custom_id.split(':');
    if (!requestId || !this.options.onApproval) return;

    await this.interactionCallback(interaction, {
      type: 4,
      data: { content: action === 'approve' ? '✅ Approved' : '❌ Rejected', flags: 64 },
    });

    const threadId = threadKey(interaction.channel_id);
    const session = await this.options.sessionBridge.resolveOrCreate('discord', threadId);
    const dcUser = interaction.member?.user?.id
      ? `discord:${interaction.member.user.id}`
      : interaction.user?.id
        ? `discord:${interaction.user.id}`
        : undefined;
    await this.options.onApproval(session.id, requestId, action === 'approve', dcUser);
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

function isAudioAttachment(attachment: NonNullable<DiscordMessage['attachments']>[number]): boolean {
  if (attachment.content_type?.startsWith('audio/')) return true;
  return /\.(ogg|oga|mp3|wav|m4a|webm|flac)$/i.test(attachment.filename);
}

function guessAudioMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/ogg';
}
