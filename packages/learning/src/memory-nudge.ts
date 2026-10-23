import type { ChatMessage, MemoryProvider } from '@anvio/core';

const FACT_PATTERNS = [
  /user prefers (.+)/i,
  /remember that (.+)/i,
  /always (.+) when/i,
  /never (.+) unless/i,
];

/**
 * Shape of a tool result folded into a `user` turn (`formatToolResultMessage`
 * in @anvio/tools). That text came from a tool, not from the person, so it must
 * never become a remembered preference (audit T-002).
 */
const TOOL_RESULT_PREFIX = /^Tool \S+ (result|failed):/;

/** How far back to look when checking a new fact against stored ones. */
const DEDUP_WINDOW = 500;

export interface MemoryNudgeResult {
  factsStored: number;
  facts: string[];
}

function normalizeFact(fact: string): string {
  return fact.trim().replace(/\s+/g, ' ').toLowerCase();
}

export class MemoryNudgeEngine {
  constructor(private readonly memory: MemoryProvider) {}

  extractFacts(messages: ChatMessage[]): string[] {
    const facts = new Map<string, string>();
    const add = (fact: string) => {
      const key = normalizeFact(fact);
      if (key && !facts.has(key)) facts.set(key, fact.trim());
    };
    for (const msg of messages) {
      if (msg.role !== 'user' || TOOL_RESULT_PREFIX.test(msg.content)) continue;
      for (const pattern of FACT_PATTERNS) {
        const match = pattern.exec(msg.content);
        if (match?.[1]) add(match[1]);
      }
      if (msg.content.length < 200 && msg.content.includes('prefer')) {
        add(msg.content);
      }
    }
    return [...facts.values()];
  }

  async nudgeFromSession(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<MemoryNudgeResult> {
    // The learning loop runs after every turn with the whole transcript, so the
    // same facts come back each time. Store only what is not already known.
    const known = new Set(
      (await this.memory.getByUser(userId, 'fact', DEDUP_WINDOW)).map((e) =>
        normalizeFact(e.content),
      ),
    );
    const facts = this.extractFacts(messages).filter((fact) => !known.has(normalizeFact(fact)));
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
