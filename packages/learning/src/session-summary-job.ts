import type { ChatMessage, MemoryProvider } from '@anvio/core';
import { SessionSummarizer } from './session-summarizer.js';

export interface StaleSessionInput {
  id: string;
  userId: string;
  messages: ChatMessage[];
  status: string;
}

export interface SessionSummaryJobResult {
  summarized: number;
  skipped: number;
  alreadySummarized: number;
}

export class SessionSummaryJob {
  private readonly memory: MemoryProvider;
  private readonly summarizer: SessionSummarizer;

  constructor(
    memory: MemoryProvider,
    summarizerOptions?: ConstructorParameters<typeof SessionSummarizer>[1],
  ) {
    this.memory = memory;
    this.summarizer = new SessionSummarizer(memory, summarizerOptions ?? {});
  }

  async summarizeStaleSessions(sessions: StaleSessionInput[]): Promise<SessionSummaryJobResult> {
    let summarized = 0;
    let skipped = 0;
    let alreadySummarized = 0;

    for (const session of sessions) {
      if (session.status !== 'completed' || session.messages.length < 2) {
        skipped += 1;
        continue;
      }

      const entries = await this.memory.getBySession(session.id);
      if (entries.some((e) => e.type === 'summary')) {
        alreadySummarized += 1;
        continue;
      }

      const result = await this.summarizer.summarizeAndStore(
        session.id,
        session.userId,
        session.messages,
      );
      if (result.stored) summarized += 1;
      else skipped += 1;
    }

    return { summarized, skipped, alreadySummarized };
  }
}
