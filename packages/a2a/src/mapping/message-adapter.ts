import { randomUUID } from 'node:crypto';
import type { ChatMessage, AgentStreamEvent } from '@anvio/core';
import type { Message, Part, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@a2a-js/sdk';
import { Role, TaskState } from '@a2a-js/sdk';
import { sessionStatusToTaskState } from './session-to-task.js';

function textPart(text: string): Part {
  return {
    content: { $case: 'text' as const, value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function makeMessage(role: Role, parts: Part[], contextId?: string, taskId?: string): Message {
  return {
    messageId: randomUUID(),
    contextId: contextId ?? '',
    taskId: taskId ?? '',
    role,
    parts,
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

export function chatMessageToA2AMessage(
  msg: ChatMessage,
  contextId?: string,
  taskId?: string,
): Message {
  const role = msg.role === 'assistant' ? Role.ROLE_AGENT : Role.ROLE_USER;
  return makeMessage(role, [textPart(msg.content)], contextId, taskId);
}

export function a2aMessageToChatMessage(msg: Message): ChatMessage {
  const role = msg.role === Role.ROLE_AGENT ? 'assistant' as const : 'user' as const;
  const texts = msg.parts
    .filter((p) => p.content?.$case === 'text')
    .map((p) => (p.content as { $case: 'text'; value: string }).value);
  return {
    role,
    content: texts.join('\n'),
  };
}

export function agentStreamEventToA2A(
  event: AgentStreamEvent,
  taskId: string,
): TaskStatusUpdateEvent | TaskArtifactUpdateEvent | null {
  switch (event.type) {
    case 'chunk':
      return null;
    case 'progress':
      return {
        taskId,
        contextId: '',
        status: {
          state: sessionStatusToTaskState(
            event.status === 'completed' ? 'completed' :
            event.status === 'failed' ? 'failed' : 'calling_model',
          ),
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      } satisfies TaskStatusUpdateEvent;
    case 'done':
      return {
        taskId,
        contextId: '',
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      } satisfies TaskStatusUpdateEvent;
    case 'error':
      return {
        taskId,
        contextId: '',
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: makeMessage(Role.ROLE_AGENT, [textPart(event.error ?? 'Unknown error')]),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      } satisfies TaskStatusUpdateEvent;
    case 'approval_required':
      return {
        taskId,
        contextId: '',
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: makeMessage(Role.ROLE_AGENT, [textPart(`Approval required: ${event.request.reason}`)]),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      } satisfies TaskStatusUpdateEvent;
    default:
      return null;
  }
}
