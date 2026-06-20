import { describe, expect, it } from 'vitest';
import { toOpenAIMessages } from './providers/openai-messages.js';

describe('toOpenAIMessages', () => {
  it('maps assistant tool calls to OpenAI format', () => {
    const messages = toOpenAIMessages({
      systemPrompt: 'You are helpful',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'anvio_tools__web_fetch', arguments: { url: 'https://x.test' } }],
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1' },
      ],
    });

    expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'anvio_tools__web_fetch',
            arguments: JSON.stringify({ url: 'https://x.test' }),
          },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"ok":true}',
    });
  });
});
