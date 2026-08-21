import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@anvio/core';
import { toAnthropicMessages } from './anthropic-messages.js';

describe('toAnthropicMessages leading-turn handling', () => {
  it('re-roles a leading assistant message to user', () => {
    // The sliding-window compressor prepends a summary; opening on an assistant
    // turn is rejected by the API, so it must be carried as user context.
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '[Context summary — 8 earlier messages compressed]\nEarlier work.',
      },
      { role: 'user', content: 'carry on' },
    ];

    const out = toAnthropicMessages(messages);

    expect(out[0]).toEqual({
      role: 'user',
      content: '[Context summary — 8 earlier messages compressed]\nEarlier work.',
    });
    expect(out[1]).toEqual({ role: 'user', content: 'carry on' });
  });

  it('leaves a non-leading assistant message as an assistant turn', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];

    expect(toAnthropicMessages(messages)[1]).toEqual({ role: 'assistant', content: 'hello' });
  });

  it('does not re-role a leading assistant message that carries tool calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'search', arguments: { q: 'x' } }],
      },
    ];

    expect(toAnthropicMessages(messages)[0]).toMatchObject({ role: 'assistant' });
  });
});
