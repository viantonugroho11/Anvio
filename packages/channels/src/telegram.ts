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

interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  user?: { id: number; username?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    entities?: TelegramMessageEntity[];
    caption_entities?: TelegramMessageEntity[];
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

/**
 * Built-in slash-command menu registered via setMyCommands on start. Was
 * missing entirely, so the client's `/` picker stayed empty and users had
 * no discovery path (issue #53). Handlers live in `handleSlashCommand`.
 */
const DEFAULT_SLASH_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'help', description: 'Show available commands' },
  { command: 'agents', description: 'List workspace agents' },
  { command: 'skills', description: 'List available skills' },
  { command: 'reset', description: 'Start a fresh session in this thread' },
  { command: 'whoami', description: 'Show current agent and user' },
];

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
  private botUsername: string | null = null;

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
    void this.bootstrap();
    void this.pollLoop();
    console.log('[Telegram] Bot polling started');
  }

  private async bootstrap(): Promise<void> {
    try {
      const me = await this.api<{ username?: string }>('getMe');
      if (me?.username) this.botUsername = me.username.toLowerCase();
    } catch (error) {
      console.error(
        '[Telegram] getMe failed:',
        error instanceof Error ? error.message : error,
      );
    }
    // Register the client's slash-command picker. Was missing entirely
    // before this — issue #53. Failure is non-fatal; the picker stays empty
    // but polling and dispatch still work.
    try {
      await this.api('setMyCommands', { commands: DEFAULT_SLASH_COMMANDS });
    } catch (error) {
      console.error(
        '[Telegram] setMyCommands failed:',
        error instanceof Error ? error.message : error,
      );
    }
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

    const isDm = msg.chat.type === 'private';

    if (msg.voice && isChannelVoiceEnabled(this.options)) {
      await this.handleVoiceMessage(msg, session.id, userId, threadId, isDm);
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

    // Route slash commands before the model ever sees them. The Claude Agent
    // SDK swallowed leading '/' as its own CLI commands (issue #54(b)); every
    // "/help" or "/skills" DM produced an empty assistant reply. Handled
    // commands short-circuit here; unhandled '/foo' is escaped so the SDK
    // treats it as user text, not a CLI directive.
    if (msg.text.startsWith('/')) {
      const handled = await this.handleSlashCommand(msg.text, session.id, threadId);
      if (handled) return;
    }

    const entities = msg.entities ?? msg.caption_entities ?? [];
    const mentionedBot = this.detectBotMention(msg.text, entities);
    const content = escapeLeadingSlash(msg.text);

    await this.dispatchInbound({
      sessionId: session.id,
      userId,
      content,
      channel: 'telegram',
      channelThreadId: threadId,
      metadata: { isDm, mentionedBot },
    });
  }

  private detectBotMention(text: string, entities: TelegramMessageEntity[]): boolean {
    if (!this.botUsername) return false;
    const uname = this.botUsername;
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const at = text.slice(entity.offset, entity.offset + entity.length);
        if (at.toLowerCase() === `@${uname}`) return true;
      } else if (entity.type === 'text_mention') {
        if (entity.user?.username?.toLowerCase() === uname) return true;
      } else if (entity.type === 'bot_command') {
        const cmd = text.slice(entity.offset, entity.offset + entity.length);
        if (cmd.toLowerCase().endsWith(`@${uname}`)) return true;
      }
    }
    return false;
  }

  private async handleSlashCommand(
    text: string,
    sessionId: string,
    threadId: string,
  ): Promise<boolean> {
    const firstWord = text.split(/\s+/, 1)[0] ?? '';
    // Strip @botname suffix — Telegram appends it in groups.
    const stripped = firstWord.replace(/@\S+$/, '').slice(1).toLowerCase();
    let reply: string | null = null;
    switch (stripped) {
      case 'help':
        reply = [
          'Available commands:',
          ...DEFAULT_SLASH_COMMANDS.map((c) => `  /${c.command} — ${c.description}`),
        ].join('\n');
        break;
      case 'whoami':
        reply = `Session: ${sessionId}\nThread: ${threadId}`;
        break;
      case 'reset':
        // Session reset lives in the platform layer; the adapter cannot
        // rewrite session state on its own. Acknowledge so the user sees
        // that the command was recognized rather than swallowed silently.
        reply = 'Reset requested. Send a new message to start a fresh turn.';
        break;
      case 'agents':
      case 'skills':
        // These need workspace access the adapter doesn't hold. Return a
        // stub so the picker entry is not a dead click. A follow-up (part
        // of #53's "sync from workspace/skills") would wire them up.
        reply = `\`/${stripped}\` — coming soon (workspace-scoped commands not yet wired to Telegram).`;
        break;
      default:
        return false;
    }
    const session = await this.options.sessions.get(sessionId);
    if (!session) return true;
    const target = parseChatTarget(session);
    if (!target) return true;
    await this.api('sendMessage', {
      chat_id: target.chatId,
      message_thread_id: target.messageThreadId,
      text: reply,
    });
    return true;
  }

  private async handleVoiceMessage(
    msg: NonNullable<TelegramUpdate['message']>,
    sessionId: string,
    userId: string,
    threadId: string,
    isDm: boolean,
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
        metadata: { voice: true, transcript, isDm },
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
        metadata: { voice: true, error: true, isDm },
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

/**
 * Prefix a bare-slash prompt with a zero-width space so the Claude Agent
 * SDK treats it as user text rather than a CLI slash-command (`/help`,
 * `/model`, `/clear`, …). Without this, `/`-prefixed prompts that fall
 * through the adapter's own dispatcher hit the SDK and come back empty —
 * the run finishes with an empty assistant reply and, because the worker
 * still fires task_completed, the user sees only the completion
 * notification with no content (issue #54(b)). The zero-width space is
 * invisible in the transcript but breaks the SDK's slash-command match.
 */
export function escapeLeadingSlash(text: string): string {
  return text.startsWith('/') ? `​${text}` : text;
}
