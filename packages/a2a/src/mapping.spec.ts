import { describe, it, expect } from 'vitest';
import { TaskState, Role } from '@a2a-js/sdk';
import type { Message, Part } from '@a2a-js/sdk';
import { sessionStatusToTaskState, taskStateToSessionStatus } from './mapping/session-to-task.js';
import { chatMessageToA2AMessage, a2aMessageToChatMessage } from './mapping/message-adapter.js';

function textPart(text: string): Part {
  return { content: { $case: 'text' as const, value: text }, metadata: undefined, filename: '', mediaType: 'text/plain' };
}

function dataPart(data: any): Part {
  return { content: { $case: 'data' as const, value: data }, metadata: undefined, filename: '', mediaType: 'application/json' };
}

function makeMsg(role: Role, parts: Part[]): Message {
  return { messageId: 'm1', contextId: '', taskId: '', role, parts, metadata: undefined, extensions: [], referenceTaskIds: [] };
}

describe('sessionStatusToTaskState', () => {
  it('maps idle to submitted', () => {
    expect(sessionStatusToTaskState('idle')).toBe(TaskState.TASK_STATE_SUBMITTED);
  });
  it('maps calling_model to working', () => {
    expect(sessionStatusToTaskState('calling_model')).toBe(TaskState.TASK_STATE_WORKING);
  });
  it('maps awaiting_approval to input_required', () => {
    expect(sessionStatusToTaskState('awaiting_approval')).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
  });
  it('maps completed to completed', () => {
    expect(sessionStatusToTaskState('completed')).toBe(TaskState.TASK_STATE_COMPLETED);
  });
  it('maps failed to failed', () => {
    expect(sessionStatusToTaskState('failed')).toBe(TaskState.TASK_STATE_FAILED);
  });
});

describe('taskStateToSessionStatus', () => {
  it('maps submitted to idle', () => {
    expect(taskStateToSessionStatus(TaskState.TASK_STATE_SUBMITTED)).toBe('idle');
  });
  it('maps working to calling_model', () => {
    expect(taskStateToSessionStatus(TaskState.TASK_STATE_WORKING)).toBe('calling_model');
  });
  it('maps input_required to awaiting_approval', () => {
    expect(taskStateToSessionStatus(TaskState.TASK_STATE_INPUT_REQUIRED)).toBe('awaiting_approval');
  });
});

describe('chatMessageToA2AMessage', () => {
  it('converts assistant ChatMessage to agent A2A Message', () => {
    const msg = chatMessageToA2AMessage(
      { role: 'assistant', content: 'Hello!' },
      'ctx-1',
      'task-1',
    );
    expect(msg.role).toBe(Role.ROLE_AGENT);
    expect(msg.parts[0]?.content?.$case).toBe('text');
    expect((msg.parts[0]?.content as any)?.value).toBe('Hello!');
    expect(msg.contextId).toBe('ctx-1');
    expect(msg.taskId).toBe('task-1');
  });

  it('converts user ChatMessage to user A2A Message', () => {
    const msg = chatMessageToA2AMessage({ role: 'user', content: 'Hi' });
    expect(msg.role).toBe(Role.ROLE_USER);
  });
});

describe('a2aMessageToChatMessage', () => {
  it('converts A2A Message to ChatMessage', () => {
    const msg = a2aMessageToChatMessage(makeMsg(Role.ROLE_AGENT, [textPart('Part 1'), textPart('Part 2')]));
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Part 1\nPart 2');
  });

  it('skips non-text parts', () => {
    const msg = a2aMessageToChatMessage(makeMsg(Role.ROLE_USER, [dataPart({ key: 'value' }), textPart('text part')]));
    expect(msg.content).toBe('text part');
  });
});
