import type { AgentRunStatus } from '@anvio/core';
import { TaskState } from '@a2a-js/sdk';

/**
 * Maps Anvio AgentRunStatus to A2A TaskState (SDK enum).
 */
export function sessionStatusToTaskState(status: AgentRunStatus): TaskState {
  switch (status) {
    case 'idle':
      return TaskState.TASK_STATE_SUBMITTED;
    case 'assembling_context':
    case 'calling_model':
    case 'tool_executing':
    case 'storing_memory':
      return TaskState.TASK_STATE_WORKING;
    case 'awaiting_approval':
      return TaskState.TASK_STATE_INPUT_REQUIRED;
    case 'completed':
      return TaskState.TASK_STATE_COMPLETED;
    case 'failed':
      return TaskState.TASK_STATE_FAILED;
    default:
      return TaskState.TASK_STATE_WORKING;
  }
}

/**
 * Maps A2A TaskState back to Anvio AgentRunStatus.
 */
export function taskStateToSessionStatus(state: TaskState): AgentRunStatus {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED:
      return 'idle';
    case TaskState.TASK_STATE_WORKING:
      return 'calling_model';
    case TaskState.TASK_STATE_INPUT_REQUIRED:
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return 'awaiting_approval';
    case TaskState.TASK_STATE_COMPLETED:
      return 'completed';
    case TaskState.TASK_STATE_FAILED:
    case TaskState.TASK_STATE_REJECTED:
    case TaskState.TASK_STATE_CANCELED:
      return 'failed';
    default:
      return 'calling_model';
  }
}
