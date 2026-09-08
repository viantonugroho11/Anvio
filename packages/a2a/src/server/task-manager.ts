import type { Task, TaskState, StreamEvent } from '../types/index.js';
import { TERMINAL_STATES, taskNotFound, taskNotCancelable } from '../types/index.js';
import type { Artifact } from '../types/artifact.js';
import type { Message } from '../types/message.js';

export type TaskEventCallback = (event: StreamEvent) => void;

interface TaskRecord {
  task: Task;
  subscribers: Set<TaskEventCallback>;
}

/**
 * In-memory task store — Level 1 compatible.
 * Manages lifecycle state machine and subscriber notifications.
 */
export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private idCounter = 0;

  createTask(contextId?: string, metadata?: Record<string, unknown>): Task {
    const id = `task_${Date.now()}_${++this.idCounter}`;
    const task: Task = {
      id,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      artifacts: [],
      history: [],
      metadata,
    };
    this.tasks.set(id, { task, subscribers: new Set() });
    return task;
  }

  getTask(id: string): Task {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    return record.task;
  }

  listTasks(contextId?: string, pageSize = 20, pageToken?: string): {
    tasks: Task[];
    nextPageToken: string;
    totalSize: number;
  } {
    let all = [...this.tasks.values()].map((r) => r.task);
    if (contextId) all = all.filter((t) => t.contextId === contextId);
    all.sort((a, b) => (b.status.timestamp ?? '').localeCompare(a.status.timestamp ?? ''));
    const startIndex = pageToken ? parseInt(pageToken, 10) : 0;
    const page = all.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + pageSize;
    return {
      tasks: page,
      nextPageToken: nextIndex < all.length ? String(nextIndex) : '',
      totalSize: all.length,
    };
  }

  updateStatus(id: string, state: TaskState, message?: Message): void {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    record.task.status = {
      state,
      message,
      timestamp: new Date().toISOString(),
    };
    this.notify(record, { taskId: id, status: record.task.status });
  }

  addArtifact(id: string, artifact: Artifact): void {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    record.task.artifacts ??= [];
    record.task.artifacts.push(artifact);
    this.notify(record, { taskId: id, artifact });
  }

  appendHistory(id: string, message: Message): void {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    record.task.history ??= [];
    record.task.history.push(message);
  }

  cancelTask(id: string): Task {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    if (TERMINAL_STATES.has(record.task.status.state)) throw taskNotCancelable(id);
    this.updateStatus(id, 'canceled');
    return record.task;
  }

  subscribe(id: string, callback: TaskEventCallback): () => void {
    const record = this.tasks.get(id);
    if (!record) throw taskNotFound(id);
    record.subscribers.add(callback);
    return () => record.subscribers.delete(callback);
  }

  isTerminal(id: string): boolean {
    return TERMINAL_STATES.has(this.getTask(id).status.state);
  }

  private notify(record: TaskRecord, event: StreamEvent): void {
    for (const cb of record.subscribers) {
      try {
        cb(event);
      } catch {
        // subscriber errors are non-fatal
      }
    }
  }
}
