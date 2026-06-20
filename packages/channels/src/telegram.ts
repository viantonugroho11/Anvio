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

export interface TelegramChannelOptions {
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

interface TelegramChatTarget {
  chatId: number;
  messageThreadId?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    voice?: { file_id: string; mime_type?: string; duration?: number };
    chat: { id: number; type: string };
    message_thread_id?: number;
    from?: { id: number; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_thread_id?: number };
    from?: { id: number };
  };
}

function threadKey(chatId: number, topicId?: number): string {
  return `chat:${chatId}:topic:${topicId ?? 0}`;
}

function parseChatTarget(session: {
  channelThread?: { threadId: string };
  metadata?: Record<string, unknown>;
}): TelegramChatTarget | null {
  const meta = session.metadata?.telegram as TelegramChatTarget | undefined;
  if (meta?.chatId) return meta;

  const threadId = session.channelThread?.threadId;
  if (!threadId) return null;
  const match = threadId.match(/^chat:(-?\d+):topic:(\d+)$/);
  if (!match) return null;
  const topic = parseInt(match[2]!, 10);
  return {
    chatId: parseInt(match[1]!, 10),
    messageThreadId: topic > 0 ? topic : undefined,
  };
}

export class TelegramChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'telegram';
  private polling = false;
  private offset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly apiBase: string;
  private readonly buffer = new Map<string, string>();

  constructor(private readonly options: TelegramChannelOptions) {
    super();
    this.apiBase = `https://api.telegram.org/bot${options.botToken}`;
  }

  private async api<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram API error: ${method}`);
    return json.result as T;
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseChatTarget(session);
    if (!target) return;

    if (message.type === 'chunk' && message.delta) {
      this.buffer.set(sessionId, (this.buffer.get(sessionId) ?? '') + message.delta);
      return;
    }

    let text = message.content ?? '';
    if (message.type === 'done') {
      text = message.content ?? this.buffer.get(sessionId) ?? text;
      this.buffer.delete(sessionId);
    }
    if (!text) return;

    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      await this.api('sendMessage', {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    }
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseChatTarget(session);
    if (!target) return;

    await this.api('sendMessage', {
      chat_id: target.chatId,
      message_thread_id: target.messageThreadId,
      text: `⚠️ *Approval required*\nTool: \`${request.toolName}\`\n${request.reason}`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve:${request.requestId}` },
            { text: '❌ Reject', callback_data: `reject:${request.requestId}` },
          ],
        ],
      },
    });
  }

  async start(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
    console.log('[Telegram] Bot polling started');
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.api<TelegramUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const update of updates ?? []) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error('[Telegram] Poll error:', error instanceof Error ? error.message : error);
        await sleep(3000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    const msg = update.message;
    if (!msg?.from) return;

    const chatId = msg.chat.id;
    const topicId = msg.message_thread_id;
    const threadId = threadKey(chatId, topicId);
    const userId = `telegram:${msg.from.id}`;

    const session = await this.options.sessionBridge.resolveOrCreate(
      'telegram',
      threadId,
      userId,
      this.options.defaultAgent,
    );

    if (!session.metadata?.telegram) {
      await this.options.sessions.update(session.id, {
        metadata: {
          ...session.metadata,
          telegram: { chatId, messageThreadId: topicId },
        },
      });
    }

    if (msg.voice && isChannelVoiceEnabled(this.options)) {
      await this.handleVoiceMessage(msg, session.id, userId, threadId);
      return;
    }

    if (!msg.text) return;

    const normalized = msg.text.trim().toLowerCase();
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
      content: msg.text,
      channel: 'telegram',
      channelThreadId: threadId,
    });
  }

  private async handleVoiceMessage(
    msg: NonNullable<TelegramUpdate['message']>,
    sessionId: string,
    userId: string,
    threadId: string,
  ): Promise<void> {
    const voice = msg.voice;
    if (!voice || !this.options.voicePipeline) return;

    try {
      const file = await this.api<{ file_path: string }>('getFile', { file_id: voice.file_id });
      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${this.options.botToken}/${file.file_path}`,
      );
      if (!fileRes.ok) throw new Error(`Telegram file download failed: ${fileRes.status}`);
      const audio = Buffer.from(await fileRes.arrayBuffer());
      const transcript = await transcribeInboundAudio(
        this.options.voicePipeline,
        audio,
        voice.mime_type ?? 'audio/ogg',
      );
      await this.dispatchInbound({
        sessionId,
        userId,
        content: voiceInboundContent(transcript),
        channel: 'telegram',
        channelThreadId: threadId,
        metadata: { voice: true, transcript },
      });
    } catch (error) {
      console.error(
        '[Telegram] Voice transcribe failed:',
        error instanceof Error ? error.message : error,
      );
      await this.dispatchInbound({
        sessionId,
        userId,
        content: '[voice] (transcription failed)',
        channel: 'telegram',
        channelThreadId: threadId,
        metadata: { voice: true, error: true },
      });
    }
  }

  private async handleCallback(cq: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    if (!cq.data || !cq.message) return;
    const [action, requestId] = cq.data.split(':');
    if (!requestId || !this.options.onApproval) return;

    await this.api('answerCallbackQuery', { callback_query_id: cq.id });

    const chatId = cq.message.chat.id;
    const threadId = threadKey(chatId, cq.message.message_thread_id);
    const session = await this.options.sessionBridge.resolveOrCreate('telegram', threadId);
    const approved = action === 'approve';
    const tgUser = cq.from?.id ? `telegram:${cq.from.id}` : undefined;
    await this.options.onApproval(session.id, requestId, approved, tgUser);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
