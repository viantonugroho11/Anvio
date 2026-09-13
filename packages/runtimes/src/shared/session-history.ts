import type { ChatMessage, RuntimeProviderId, RuntimeRequest } from '@anvio/core';

/**
 * Vendor runtimes are stateless per invocation: they receive a prompt and
 * return a reply. Anvio's conversation state lives in
 * `session.state.messages`, so without one of the two strategies here every
 * turn reads to the vendor as the first message of the conversation
 * (issue #63).
 *
 * Strategy 1 — native resume: the vendor keeps its own transcript and hands
 * back a session handle. We store it under
 * `session.state.metadata.vendorSessions[runtimeId]` and pass it back next
 * turn. Free, and the vendor's own compaction applies.
 *
 * Strategy 2 — transcript prelude: replay the stored messages ahead of the
 * new input. Portable to every vendor, but costs tokens each turn, so it is
 * the fallback for runtimes without resume and for the first turn after a
 * vendor session expires.
 */

/** Where per-runtime vendor handles live inside `SessionState.metadata`. */
export const VENDOR_SESSIONS_METADATA_KEY = 'vendorSessions';

/**
 * Read the vendor handle this runtime issued for this session, if any.
 *
 * Keyed per runtime id on purpose: an agent whose fallback chain moved from
 * `claude-code` to `codex` must not hand Codex a Claude transcript id.
 */
export function readVendorSessionId(
  request: RuntimeRequest,
  runtimeId: RuntimeProviderId,
): string | undefined {
  const bag = request.session.state.metadata?.[VENDOR_SESSIONS_METADATA_KEY];
  if (!bag || typeof bag !== 'object') return undefined;
  const value = (bag as Record<string, unknown>)[runtimeId];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export interface PromptWithHistoryOptions {
  /**
   * Budget for the rendered history block. Messages are taken from the tail
   * (most recent first) until the budget is spent, so the turns nearest the
   * new input always survive.
   */
  maxChars?: number;
}

const DEFAULT_HISTORY_CHARS = 12_000;

function renderMessage(message: ChatMessage): string {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user';
  return `<${role}>\n${message.content}\n</${role}>`;
}

/**
 * Render `session.state.messages` as a prelude ahead of the current input.
 *
 * Returns `input.content` unchanged when there is no history, so a first
 * turn is byte-identical to the pre-#63 behavior.
 */
export function buildPromptWithHistory(
  request: RuntimeRequest,
  options: PromptWithHistoryOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_HISTORY_CHARS;
  const messages = request.session.state.messages ?? [];
  if (messages.length === 0 || maxChars <= 0) return request.input.content;

  const rendered: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const block = renderMessage(messages[i]!);
    if (used + block.length > maxChars) break;
    rendered.unshift(block);
    used += block.length;
  }
  if (rendered.length === 0) return request.input.content;

  const truncated = rendered.length < messages.length;
  return [
    '<conversation_history>',
    truncated ? '<!-- earlier turns omitted to fit the context budget -->' : null,
    ...rendered,
    '</conversation_history>',
    '',
    request.input.content,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * Prompt for a runtime that supports native resume: when a vendor handle
 * exists the vendor already holds the transcript, so sending it again would
 * duplicate context and burn tokens. Only the cold path gets the prelude.
 */
export function buildResumeAwarePrompt(
  request: RuntimeRequest,
  vendorSessionId: string | undefined,
  options: PromptWithHistoryOptions = {},
): string {
  return vendorSessionId ? request.input.content : buildPromptWithHistory(request, options);
}
