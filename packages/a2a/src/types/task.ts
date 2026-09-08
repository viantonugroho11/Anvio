/** A2A v1.0 Task — lifecycle-managed work unit. */

import type { Artifact } from './artifact.js';
import type { Message } from './message.js';

export type TaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input_required'
  | 'auth_required'
  | 'rejected';

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  status: TaskStatus;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  artifact: Artifact;
}

export type StreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
