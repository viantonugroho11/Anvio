import { describe, expect, it } from 'vitest';
import { SessionSummaryJob } from './session-summary-job.js';

describe('SessionSummaryJob', () => {
  it('summarizes completed sessions without existing summary', async () => {
    const stored: Array<{ sessionId: string; type: string; content: string }> = [];
    const memory = {
      providerId: 'test',
      async getBySession(sessionId: string) {
        return stored.filter((s) => s.sessionId === sessionId).map((s) => ({
          id: '1',
          sessionId: s.sessionId,
          userId: 'u1',
          type: s.type as 'summary',
          content: s.content,
          createdAt: new Date(),
        }));
      },
      async store(entry: { sessionId: string; type: string; content: string; userId: string }) {
        stored.push(entry);
      },
      async getMessages() {
        return [];
      },
      async setMessages() {},
      async appendMessage() {},
      async clearSession() {},
      async getByUser() {
        return [];
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const job = new SessionSummaryJob(memory as never);
    const result = await job.summarizeStaleSessions([
      {
        id: 's1',
        userId: 'u1',
        status: 'completed',
        messages: [
          { role: 'user', content: 'Explain microservices' },
          { role: 'assistant', content: 'Microservices are small independent services.' },
        ],
      },
    ]);

    expect(result.summarized).toBe(1);
    expect(stored.some((s) => s.type === 'summary')).toBe(true);
  });
});
