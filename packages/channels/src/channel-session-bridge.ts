import type { ChannelType, SessionStore, StoredSession } from '@anvio/core';
import { KeyedSerialQueue } from '@anvio/core';

export interface ChannelSessionBridgeDefaults {
  defaultAgent: string;
  defaultUserId: string;
}

/** Maps external channel threads to agent sessions (create or resume). */
export class ChannelSessionBridge {
  /**
   * Lookup-then-create is not atomic: two first messages in a new thread arriving
   * together used to create two sessions, splitting the conversation in half.
   */
  private readonly resolving = new KeyedSerialQueue();

  constructor(
    private readonly sessions: SessionStore,
    private readonly defaults: ChannelSessionBridgeDefaults,
  ) {}

  async resolveOrCreate(
    channel: ChannelType,
    threadId: string,
    userId?: string,
    agentName?: string,
  ): Promise<StoredSession> {
    return this.resolving.run(`${channel}\u0000${threadId}`, async () => {
      const existing = await this.sessions.getByChannelThread(channel, threadId);
      if (existing) return existing;

      return this.sessions.create({
        userId: userId ?? this.defaults.defaultUserId,
        agentName: agentName ?? this.defaults.defaultAgent,
        channel,
        messages: [],
        status: 'idle',
        channelThread: { channel, threadId },
        detached: true,
      });
    });
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    return this.sessions.get(sessionId);
  }
}
