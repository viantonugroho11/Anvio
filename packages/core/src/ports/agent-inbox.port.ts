import type { InboxMessage } from '../types/channel.js';

export interface AgentInbox {
  inject(message: Omit<InboxMessage, 'id' | 'createdAt'>): Promise<InboxMessage>;
  drain(sessionId: string): Promise<InboxMessage[]>;
  peek(sessionId: string): Promise<InboxMessage[]>;
  clear(sessionId: string): Promise<void>;
}
