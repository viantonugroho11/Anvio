import type { SessionStore } from '@anvio/core';

export interface SessionActivityRecord {
  sessionId: string;
  lastActiveAt: string;
}

export class SessionResumeTracker {
  constructor(
    private readonly sessions: SessionStore,
    private readonly idleMinutes: number,
  ) {}

  async recordActivity(sessionId: string, now = new Date()): Promise<void> {
    await this.sessions.update(sessionId, {
      lastActiveAt: now.toISOString(),
      metadata: { harnessLastActiveAt: now.toISOString() },
    });
  }

  async isIdle(sessionId: string, now = new Date()): Promise<boolean> {
    const session = await this.sessions.get(sessionId);
    if (!session) return true;
    const last = new Date(session.lastActiveAt);
    const diffMs = now.getTime() - last.getTime();
    return diffMs > this.idleMinutes * 60_000;
  }
}
