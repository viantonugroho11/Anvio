import { createClient } from 'redis';
import type { ChatMessage, ShortTermMemoryPort } from '@anvio/core';

const KEY_PREFIX = 'anvio:session:';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<string>;
  del(key: string): Promise<number>;
}

export class RedisShortTermMemory implements ShortTermMemoryPort {
  constructor(private readonly redis: RedisLike) {}

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}:messages`;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const data = await this.redis.get(this.key(sessionId));
    if (!data) return [];
    return JSON.parse(data) as ChatMessage[];
  }

  async setMessages(sessionId: string, messages: ChatMessage[], ttlSeconds = 3600): Promise<void> {
    await this.redis.setEx(this.key(sessionId), ttlSeconds, JSON.stringify(messages));
  }

  async appendMessage(sessionId: string, message: ChatMessage, ttlSeconds = 3600): Promise<void> {
    const messages = await this.getMessages(sessionId);
    messages.push(message);
    await this.setMessages(sessionId, messages, ttlSeconds);
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}

export async function createRedisClient(url: string): Promise<RedisLike> {
  const client = createClient({ url });
  await client.connect();
  return client as unknown as RedisLike;
}
