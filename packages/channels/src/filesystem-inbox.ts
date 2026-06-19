import { v4 as uuidv4 } from 'uuid';
import type { AgentInbox, InboxMessage } from '@anvio/core';
import type { StorageProvider } from '@anvio/core';

/** Filesystem-backed inbox — survives process restart. */
export class FilesystemAgentInbox implements AgentInbox {
  constructor(private readonly storage: StorageProvider) {}

  private key(sessionId: string): string {
    return `inbox/${sessionId}.json`;
  }

  private async readQueue(sessionId: string): Promise<InboxMessage[]> {
    return (await this.storage.readJson<InboxMessage[]>(this.key(sessionId))) ?? [];
  }

  private async writeQueue(sessionId: string, queue: InboxMessage[]): Promise<void> {
    if (queue.length === 0) {
      await this.storage.delete(this.key(sessionId));
      return;
    }
    await this.storage.writeJson(this.key(sessionId), queue);
  }

  async inject(message: Omit<InboxMessage, 'id' | 'createdAt'>): Promise<InboxMessage> {
    const entry: InboxMessage = {
      ...message,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    const queue = await this.readQueue(message.sessionId);
    queue.push(entry);
    await this.writeQueue(message.sessionId, queue);
    return entry;
  }

  async drain(sessionId: string): Promise<InboxMessage[]> {
    const queue = await this.readQueue(sessionId);
    await this.writeQueue(sessionId, []);
    return queue;
  }

  async peek(sessionId: string): Promise<InboxMessage[]> {
    return this.readQueue(sessionId);
  }

  async clear(sessionId: string): Promise<void> {
    await this.writeQueue(sessionId, []);
  }
}

/** @deprecated Use FilesystemAgentInbox for persistence. */
export { LocalAgentInbox } from './agent-inbox.js';
