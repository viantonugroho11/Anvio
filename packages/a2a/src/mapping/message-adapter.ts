import { randomUUID } from 'node:crypto';
import type { ChatMessage, AgentStreamEvent } from '@anvio/core';
import type { Message, Part, Role } from '../types/message.js';
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../types/task.js';
import { sessionStatusToTaskState } from './session-to-task.js';

/**
 * Converts an Anvio ChatMessage to an A2A Message.
 */
export function chatMessageToA2AMessage(
  msg: ChatMessage,
  contextId?: string,
  taskId?: string,
): Message {
  const role: Role = msg.role === 'assistant' ? 'agent' : 'user';
  const parts: Part[] = [{ type: 'text', text: msg.content }];
  return {
    messageId: randomUUID(),
    contextId,
    taskId,
    role,
    parts,
  };
}

/**
 * Converts an A2A Message to an Anvio ChatMessage.
 */
export function a2aMessageToChatMessage(msg: Message): ChatMessage {
  const role = msg.role === 'agent' ? 'assistant' as const : 'user' as const;
  const textParts = msg.parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text);
  return {
    role,
    content: textParts.join('\n'),
  };
}

/**
 * Converts an Anvio AgentStreamEvent to A2A stream events.
 */
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
        status: {
          state: sessionStatusToTaskState(
            event.status === 'completed' ? 'completed' :
            event.status === 'failed' ? 'failed' : 'calling_model',
          ),
          timestamp: new Date().toISOString(),
        },
      };
    case 'done':
      return {
        taskId,
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
      };
    case 'error':
      return {
        taskId,
        status: {
          state: 'failed',
          message: {
            messageId: randomUUID(),
            role: 'agent',
            parts: [{ type: 'text', text: event.error ?? 'Unknown error' }],
          },
          timestamp: new Date().toISOString(),
        },
      };
    case 'approval_required':
      return {
        taskId,
        status: {
          state: 'input_required',
          message: {
            messageId: randomUUID(),
            role: 'agent',
            parts: [{ type: 'text', text: `Approval required: ${event.request.reason}` }],
          },
          timestamp: new Date().toISOString(),
        },
      };
    default:
      return null;
  }
}
