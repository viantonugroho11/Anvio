import type { AgentRunStatus } from '@anvio/core';
import type { TaskState } from '../types/task.js';

/**
 * Maps Anvio AgentRunStatus to A2A TaskState.
 *
 * Anvio sessions have a simpler lifecycle; A2A has richer terminal/interrupt
 * states. This mapping preserves the semantic meaning while bridging the gap.
 */
export function sessionStatusToTaskState(status: AgentRunStatus): TaskState {
  switch (status) {
    case 'idle':
      return 'submitted';
    case 'assembling_context':
    case 'calling_model':
    case 'tool_executing':
    case 'storing_memory':
      return 'working';
    case 'awaiting_approval':
      return 'input_required';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'working';
  }
}

/**
 * Maps A2A TaskState back to the closest Anvio AgentRunStatus.
 * Used when an external A2A agent reports status back.
 */
export function taskStateToSessionStatus(state: TaskState): AgentRunStatus {
  switch (state) {
    case 'submitted':
      return 'idle';
    case 'working':
      return 'calling_model';
    case 'input_required':
    case 'auth_required':
      return 'awaiting_approval';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'rejected':
    case 'canceled':
      return 'failed';
    default:
      return 'calling_model';
  }
}
