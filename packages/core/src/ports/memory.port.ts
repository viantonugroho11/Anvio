import type { ChatMessage } from '../types/common.js';

export type MemoryEntryType = 'fact' | 'preference' | 'conversation' | 'summary';

export interface MemoryEntry {
  id?: string;
  sessionId: string;
  userId: string;
  type: MemoryEntryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface MemoryContext {
  shortTerm: ChatMessage[];
  longTerm: MemoryEntry[];
  semantic?: MemoryEntry[];
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  userId?: string;
}

export interface ShortTermMemoryPort {
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  setMessages(sessionId: string, messages: ChatMessage[], ttlSeconds?: number): Promise<void>;
  appendMessage(sessionId: string, message: ChatMessage, ttlSeconds?: number): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export interface LongTermMemoryPort {
  store(entry: MemoryEntry): Promise<MemoryEntry>;
  getBySession(sessionId: string, limit?: number): Promise<MemoryEntry[]>;
  getByUser(userId: string, type?: MemoryEntryType, limit?: number): Promise<MemoryEntry[]>;
}

export interface SemanticMemoryPort {
  store(entry: MemoryEntry, embedding?: number[]): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
}

export interface MemoryStore {
  getContext(sessionId: string, userId: string): Promise<MemoryContext>;
  storeConversation(sessionId: string, userId: string, messages: ChatMessage[]): Promise<void>;
  storeEntry(entry: MemoryEntry): Promise<void>;
}
