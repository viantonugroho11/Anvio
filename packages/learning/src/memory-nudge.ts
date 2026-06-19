import type { ChatMessage, MemoryProvider } from '@anvio/core';

const FACT_PATTERNS = [
  /user prefers (.+)/i,
  /remember that (.+)/i,
  /always (.+) when/i,
  /never (.+) unless/i,
];

export interface MemoryNudgeResult {
  factsStored: number;
  facts: string[];
}

export class MemoryNudgeEngine {
  constructor(private readonly memory: MemoryProvider) {}

  extractFacts(messages: ChatMessage[]): string[] {
    const facts = new Set<string>();
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of FACT_PATTERNS) {
        const match = pattern.exec(msg.content);
        if (match?.[1]) facts.add(match[1].trim());
      }
      if (msg.content.length < 200 && msg.content.includes('prefer')) {
        facts.add(msg.content.trim());
      }
    }
    return [...facts];
  }

  async nudgeFromSession(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<MemoryNudgeResult> {
    const facts = this.extractFacts(messages);
    for (const fact of facts) {
      await this.memory.store({
        sessionId,
        userId,
        type: 'fact',
        content: fact,
      });
    }
    return { factsStored: facts.length, facts };
  }
}
