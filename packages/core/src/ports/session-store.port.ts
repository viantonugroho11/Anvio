import type { ChatMessage } from '../types/common.js';
import type { AgentRunStatus } from '../types/common.js';
import type { ApprovalRequest } from './agent-runtime.port.js';
import type { ChannelThreadRef } from '../types/channel.js';

export interface StoredSession {
  id: string;
  userId: string;
  agentName: string;
  channel: string;
  messages: ChatMessage[];
  status: AgentRunStatus;
  createdAt: string;
  lastActiveAt: string;
  /** External thread/topic mapping (Telegram topic, Discord thread, Slack thread, etc.) */
  channelThread?: ChannelThreadRef;
  /** Parent session for multi-agent subagent runs */
  parentSessionId?: string;
  /** Agent continues after user disconnects */
  detached?: boolean;
  pendingApproval?: ApprovalRequest;
  metadata?: Record<string, unknown>;
}

export interface SessionSearchHit {
  sessionId: string;
  agentName: string;
  channel: string;
  snippet: string;
}

export interface SessionStore {
  create(session: Omit<StoredSession, 'id' | 'createdAt' | 'lastActiveAt'>): Promise<StoredSession>;
  get(id: string): Promise<StoredSession | null>;
  getByChannelThread(channel: string, threadId: string): Promise<StoredSession | null>;
  update(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null>;
  list(userId?: string): Promise<StoredSession[]>;
  listActive(userId?: string): Promise<StoredSession[]>;
  /** FTS-backed search when store supports it (SQLite). */
  searchMessages?(query: string, limit?: number): Promise<SessionSearchHit[]>;
}
