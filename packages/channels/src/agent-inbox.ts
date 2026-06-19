import { v4 as uuidv4 } from 'uuid';
import type { AgentInbox, InboxMessage } from '@anvio/core';

/** In-process inbox for injecting instructions into running agent sessions. */
export class LocalAgentInbox implements AgentInbox {
  private readonly queues = new Map<string, InboxMessage[]>();

  async inject(message: Omit<InboxMessage, 'id' | 'createdAt'>): Promise<InboxMessage> {
    const entry: InboxMessage = {
      ...message,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    const queue = this.queues.get(message.sessionId) ?? [];
    queue.push(entry);
    this.queues.set(message.sessionId, queue);
    return entry;
  }

  async drain(sessionId: string): Promise<InboxMessage[]> {
    const queue = this.queues.get(sessionId) ?? [];
    this.queues.delete(sessionId);
    return queue;
  }

  async peek(sessionId: string): Promise<InboxMessage[]> {
    return [...(this.queues.get(sessionId) ?? [])];
  }

  async clear(sessionId: string): Promise<void> {
    this.queues.delete(sessionId);
  }
}
