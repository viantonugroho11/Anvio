import type { ChatMessage } from '@anvio/core';

/** Tool results sent back as user messages by the fenced-block tool loop. */
const PARSED_TOOL_RESULT = /^Tool \S+ (?:result|failed):\n/;

/**
 * The messages of `next` that are new since `previous` was stored, limited to
 * user and assistant text worth recalling later.
 *
 * `storeConversation` used to copy the last two messages of every write into
 * long-term memory. A turn that failed and was retried, or a turn paused for
 * approval, re-stored messages already there, and in tool turns the "last two"
 * were a tool result and the answer rather than the question and the answer
 * (audit CQ-021). The runtime always writes the previous history followed by the
 * new turn, so the new part is whatever follows the longest common prefix.
 */
export function newConversationEntries(
  previous: ChatMessage[],
  next: ChatMessage[],
): ChatMessage[] {
  let common = 0;
  while (
    common < previous.length &&
    common < next.length &&
    previous[common]!.role === next[common]!.role &&
    previous[common]!.content === next[common]!.content
  ) {
    common++;
  }
  return next
    .slice(common)
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.content.trim() !== '' &&
        !(m.role === 'user' && PARSED_TOOL_RESULT.test(m.content)),
    );
}
