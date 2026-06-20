import type { BuiltinToolResult, MemoryEntry } from '@anvio/core';

export type MemoryRecallFn = (
  userId: string,
  query: string,
  limit?: number,
) => Promise<MemoryEntry[]>;

export async function memoryRecall(
  recall: MemoryRecallFn | undefined,
  userId: string,
  query: string,
  limit = 10,
): Promise<BuiltinToolResult> {
  if (!recall) {
    return {
      name: 'anvio_tools__memory_recall',
      output: null,
      status: 'failed',
      error: 'memoryRecall not configured',
    };
  }
  if (!query.trim()) {
    return {
      name: 'anvio_tools__memory_recall',
      output: null,
      status: 'failed',
      error: 'query required',
    };
  }

  try {
    const entries = await recall(userId || 'local-user', query, limit);
    return {
      name: 'anvio_tools__memory_recall',
      output: {
        query,
        count: entries.length,
        entries: entries.map((entry) => ({
          id: entry.id,
          sessionId: entry.sessionId,
          type: entry.type,
          content: entry.content,
          createdAt: entry.createdAt,
        })),
      },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__memory_recall',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
