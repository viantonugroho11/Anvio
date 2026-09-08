import { describe, it, expect } from 'vitest';
import { sessionStatusToTaskState, taskStateToSessionStatus } from './mapping/session-to-task.js';
import { chatMessageToA2AMessage, a2aMessageToChatMessage } from './mapping/message-adapter.js';

describe('sessionStatusToTaskState', () => {
  it('maps idle to submitted', () => {
    expect(sessionStatusToTaskState('idle')).toBe('submitted');
  });
  it('maps calling_model to working', () => {
    expect(sessionStatusToTaskState('calling_model')).toBe('working');
  });
  it('maps awaiting_approval to input_required', () => {
    expect(sessionStatusToTaskState('awaiting_approval')).toBe('input_required');
  });
  it('maps completed to completed', () => {
    expect(sessionStatusToTaskState('completed')).toBe('completed');
  });
  it('maps failed to failed', () => {
    expect(sessionStatusToTaskState('failed')).toBe('failed');
  });
});

describe('taskStateToSessionStatus', () => {
  it('maps submitted to idle', () => {
    expect(taskStateToSessionStatus('submitted')).toBe('idle');
  });
  it('maps working to calling_model', () => {
    expect(taskStateToSessionStatus('working')).toBe('calling_model');
  });
  it('maps input_required to awaiting_approval', () => {
    expect(taskStateToSessionStatus('input_required')).toBe('awaiting_approval');
  });
});

describe('chatMessageToA2AMessage', () => {
  it('converts assistant ChatMessage to agent A2A Message', () => {
    const msg = chatMessageToA2AMessage(
      { role: 'assistant', content: 'Hello!' },
      'ctx-1',
      'task-1',
    );
    expect(msg.role).toBe('agent');
    expect(msg.parts[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(msg.contextId).toBe('ctx-1');
    expect(msg.taskId).toBe('task-1');
  });

  it('converts user ChatMessage to user A2A Message', () => {
    const msg = chatMessageToA2AMessage({ role: 'user', content: 'Hi' });
    expect(msg.role).toBe('user');
  });
});

describe('a2aMessageToChatMessage', () => {
  it('converts A2A Message to ChatMessage', () => {
    const msg = a2aMessageToChatMessage({
      messageId: 'm1',
      role: 'agent',
      parts: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ],
    });
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Part 1\nPart 2');
  });

  it('skips non-text parts', () => {
    const msg = a2aMessageToChatMessage({
      messageId: 'm2',
      role: 'user',
      parts: [
        { type: 'data', data: { key: 'value' } },
        { type: 'text', text: 'text part' },
      ],
    });
    expect(msg.content).toBe('text part');
  });
});
