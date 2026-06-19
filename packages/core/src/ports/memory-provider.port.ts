import type { ChatMessage } from '../types/common.js';
import type {
  MemoryEntry,
  MemoryEntryType,
  MemoryStore,
  SearchOptions,
} from './memory.port.js';

export interface MemoryProviderHealth {
  ok: boolean;
  details?: string;
}

export interface MemoryProvider extends MemoryStore {
  readonly providerId: string;

  getMessages(sessionId: string): Promise<ChatMessage[]>;
  setMessages(sessionId: string, messages: ChatMessage[], ttlSeconds?: number): Promise<void>;
  appendMessage(sessionId: string, message: ChatMessage, ttlSeconds?: number): Promise<void>;
  clearSession(sessionId: string): Promise<void>;

  store(entry: MemoryEntry): Promise<MemoryEntry>;
  getBySession(sessionId: string, limit?: number): Promise<MemoryEntry[]>;
  getByUser(userId: string, type?: MemoryEntryType, limit?: number): Promise<MemoryEntry[]>;

  storeSemantic?(entry: MemoryEntry, embedding?: number[]): Promise<void>;
  search?(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;

  healthCheck(): Promise<MemoryProviderHealth>;
  migrate?(target: MemoryProvider): Promise<void>;
}
