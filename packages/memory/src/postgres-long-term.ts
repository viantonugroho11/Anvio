import { desc, eq } from 'drizzle-orm';
import type { LongTermMemoryPort, MemoryEntry } from '@anvio/core';
import type { Database } from '@anvio/db';
import { memoryEntries } from '@anvio/db';

export class PostgresLongTermMemory implements LongTermMemoryPort {
  constructor(private readonly db: Database) {}

  async store(entry: MemoryEntry): Promise<MemoryEntry> {
    const [row] = await this.db
      .insert(memoryEntries)
      .values({
        sessionId: entry.sessionId,
        userId: entry.userId,
        type: entry.type,
        content: entry.content,
        metadata: entry.metadata ?? {},
      })
      .returning();
    return {
      id: row.id,
      sessionId: row.sessionId ?? entry.sessionId,
      userId: row.userId,
      type: entry.type,
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt,
    };
  }

  async getBySession(sessionId: string, limit = 50): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.sessionId, sessionId))
      .orderBy(desc(memoryEntries.createdAt))
      .limit(limit);
    return rows.map(this.toEntry);
  }

  async getByUser(
    userId: string,
    type?: MemoryEntry['type'],
    limit = 50,
  ): Promise<MemoryEntry[]> {
    const query = this.db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.userId, userId))
      .orderBy(desc(memoryEntries.createdAt))
      .limit(limit);
    const rows = await query;
    return rows
      .filter((r) => !type || r.type === type)
      .map(this.toEntry);
  }

  private toEntry(row: typeof memoryEntries.$inferSelect): MemoryEntry {
    return {
      id: row.id,
      sessionId: row.sessionId ?? '',
      userId: row.userId,
      type: row.type as MemoryEntry['type'],
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt,
    };
  }
}
