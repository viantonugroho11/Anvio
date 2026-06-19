import type { ChatMessage } from '../types/common.js';
import type { AgentRunStatus } from '../types/common.js';

export interface StoredSession {
  id: string;
  userId: string;
  agentName: string;
  channel: string;
  messages: ChatMessage[];
  status: AgentRunStatus;
  createdAt: string;
  lastActiveAt: string;
}

export interface SessionStore {
  create(session: Omit<StoredSession, 'id' | 'createdAt' | 'lastActiveAt'>): Promise<StoredSession>;
  get(id: string): Promise<StoredSession | null>;
  update(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null>;
  list(userId?: string): Promise<StoredSession[]>;
}
