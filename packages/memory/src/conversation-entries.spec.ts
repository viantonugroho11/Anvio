import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@anvio/core';
import { newConversationEntries } from './conversation-entries.js';

const u = (content: string): ChatMessage => ({ role: 'user', content });
const a = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('newConversationEntries', () => {
  it('returns only what follows the stored history', () => {
    expect(
      newConversationEntries([u('q1'), a('a1')], [u('q1'), a('a1'), u('q2'), a('a2')]),
    ).toEqual([u('q2'), a('a2')]);
  });

  it('does not re-store messages when an unfinished turn is followed by its retry', () => {
    const history = [u('q1'), a('a1')];
    const unfinished = [...history, u('q2')];
    expect(newConversationEntries(history, unfinished)).toEqual([u('q2')]);
    const retried = [...unfinished, u('q2 again'), a('a2')];
    expect(newConversationEntries(unfinished, retried)).toEqual([u('q2 again'), a('a2')]);
  });

  it('keeps the question and answer of a tool turn, not the tool traffic', () => {
    const next: ChatMessage[] = [
      u('find it'),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 't', arguments: {} }] },
      { role: 'tool', name: 't', toolCallId: 'c', content: 'Tool t result:\nx' },
      u('Tool anvio_tools__read result:\nfile body'),
      a('found it'),
    ];
    expect(newConversationEntries([], next)).toEqual([u('find it'), a('found it')]);
  });
});
