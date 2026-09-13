import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  ProgressUpdate,
  SessionStore,
  SlashCommandRegistry,
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
  /**
   * Registry consulted at start() to sync the Bot API `setMyCommands`
   * picker with what the workspace actually exposes. When absent, the
   * adapter falls back to a small built-in set so the picker is never
   * empty (issue #53). Runtime dispatch of `/foo` messages happens in
   * platform's createInboundHandler — see ADR-0023.
   */
  slashCommands?: SlashCommandRegistry;
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

/** Telegram expires a chat action after ~5s; refresh just inside that. */
const TYPING_REFRESH_MS = 4000;

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
  /**
   * One `sendChatAction` keepalive per in-flight session. Telegram expires
   * a chat action after ~5s, so the indicator has to be re-sent until the
   * reply lands (issue #70). Keyed by sessionId; every exit path must call
   * `setTyping(id, false)` or the timer leaks.
   */
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();
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
      // Deltas are buffered until `done` (per-token editMessageText would
      // blow the Bot API rate limit), so the chat action is the only
      // progress signal the user gets while the turn runs.
      await this.setTyping(sessionId, true);
      return;
    }

    // Anything that renders text ends the "typing…" state — the user can
    // now see output, so the indicator would be a lie.
    await this.setTyping(sessionId, false);

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

  /**
   * Telegram renders progress as the native "typing…" action rather than
   * the base adapter's text bubble — a run emits several phases per turn
   * and each one as its own message buried the actual reply (issue #54(a)).
   */
  async sendProgress(sessionId: string, update: ProgressUpdate): Promise<void> {
    await this.setTyping(sessionId, update.status === 'running');
  }

  async setTyping(sessionId: string, active: boolean): Promise<void> {
    if (!active) {
      const timer = this.typingTimers.get(sessionId);
      if (timer) clearInterval(timer);
      this.typingTimers.delete(sessionId);
      return;
    }
    if (this.typingTimers.has(sessionId)) return;

    // Register the timer before the first await: two deltas arriving back
    // to back would otherwise both pass the guard above and start their
    // own keepalive, leaving one orphaned.
    const timer = setInterval(() => void this.sendChatAction(sessionId), TYPING_REFRESH_MS);
    timer.unref?.();
    this.typingTimers.set(sessionId, timer);
    await this.sendChatAction(sessionId);
  }

  private async sendChatAction(sessionId: string): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseChatTarget(session);
    if (!target) return;
    try {
      await this.api('sendChatAction', {
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId,
        action: 'typing',
      });
    } catch (error) {
      // Cosmetic signal — never fail a turn over it.
      console.error(
        '[Telegram] sendChatAction failed:',
        error instanceof Error ? error.message : error,
      );
    }
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
    // before v2.0.2 — issue #53. As of v2.1.0 the list is generated from
    // the workspace-scoped SlashCommandRegistry (ADR-0023) when one is
    // supplied, and falls back to a small hardcoded set otherwise. Failure
    // is non-fatal; the picker stays empty but polling and dispatch still
    // work.
    const commands = this.options.slashCommands
      ? buildTelegramCommandList(this.options.slashCommands.list())
      : DEFAULT_SLASH_COMMANDS;
    try {
      await this.api('setMyCommands', { commands });
    } catch (error) {
      // Telegram fails the whole batch on the first invalid entry
      // (regression: issue #59, v2.3.0). buildTelegramCommandList already
      // sanitises/filters; log so an unexpected shape is still visible.
      console.error(
        '[Telegram] setMyCommands failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for (const timer of this.typingTimers.values()) clearInterval(timer);
    this.typingTimers.clear();
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

    // Slash-command dispatch lives in createInboundHandler now (ADR-0023);
    // the adapter forwards the raw text and the router short-circuits
    // known commands. Unknown `/foo` that reaches the model is escaped
    // there too so downstream vendors don't treat it as a CLI directive
    // (issue #54(b)).
    const entities = msg.entities ?? msg.caption_entities ?? [];
    const mentionedBot = this.detectBotMention(msg.text, entities);

    await this.dispatchInbound({
      sessionId: session.id,
      userId,
      content: msg.text,
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

  // Slash dispatch moved to platform's createInboundHandler in v2.1.0
  // (ADR-0023). Adapter keeps the escape utility below for the fall-
  // through path only.

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
  return text.startsWith('/') ? `\u200b${text}` : text;
}

/**
 * Telegram limits command descriptions to 256 chars but the picker
 * truncates far earlier; keep it under 100 so the visible line reads
 * cleanly across mobile widths.
 */
function truncateDescription(text: string): string {
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

/**
 * Telegram Bot API constrains command names to `[a-z0-9_]{1,32}`. Any
 * other character (`-`, `.`, uppercase, whitespace) causes `setMyCommands`
 * to reject the ENTIRE batch (issue #59). Sanitise per-entry:
 *   - drop `syncable === false` entries (router still dispatches them);
 *   - lower-case, replace `-`/`.`/whitespace with `_`, drop everything else;
 *   - truncate at 32;
 *   - skip entries that end up empty or start with a digit (Telegram wants
 *     the first char to be a letter or underscore).
 *
 * Exported so unit tests can pin the shape without spinning a bot.
 */
export function buildTelegramCommandList(
  commands: Array<{ name: string; description: string; syncable?: boolean }>,
): Array<{ command: string; description: string }> {
  const out: Array<{ command: string; description: string }> = [];
  const seen = new Set<string>();
  for (const c of commands) {
    if (c.syncable === false) continue;
    const sanitized = c.name
      .toLowerCase()
      .replace(/[-.\s]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 32)
      .replace(/^[^a-z_]+/, '');
    if (!sanitized || !/[a-z0-9]/.test(sanitized)) {
      console.warn(`[Telegram] skipping unsyncable command name: ${c.name}`);
      continue;
    }
    if (seen.has(sanitized)) continue;
    seen.add(sanitized);
    out.push({ command: sanitized, description: truncateDescription(c.description) });
  }
  return out;
}
