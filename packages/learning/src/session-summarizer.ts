import type { ChatMessage, MemoryProvider } from '@anvio/core';

export interface SessionSummaryResult {
  summary: string;
  stored: boolean;
}

/** Rule-based session summarizer — stores compact summary for cross-session recall. */
export class SessionSummarizer {
  constructor(private readonly memory: MemoryProvider) {}

  summarize(messages: ChatMessage[]): string {
    const userMsgs = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const assistantMsgs = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    if (userMsgs.length === 0) return '';

    const topics = userMsgs.slice(-3).map((m) => m.slice(0, 120).replace(/\s+/g, ' ').trim());
    const lastReply = assistantMsgs.at(-1)?.slice(0, 280).replace(/\s+/g, ' ').trim() ?? '';

    return [
      `Topics: ${topics.join(' | ')}`,
      lastReply ? `Last outcome: ${lastReply}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async summarizeAndStore(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<SessionSummaryResult> {
    const summary = this.summarize(messages);
    if (!summary) return { summary: '', stored: false };

    await this.memory.store({
      sessionId,
      userId,
      type: 'summary',
      content: summary,
    });

    return { summary, stored: true };
  }
}
