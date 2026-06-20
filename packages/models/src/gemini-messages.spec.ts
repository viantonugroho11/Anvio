import { describe, expect, it } from 'vitest';
import {
  extractGeminiToolCalls,
  toGeminiContents,
} from './providers/gemini-messages.js';

describe('toGeminiContents', () => {
  it('maps assistant tool calls to Gemini functionCall parts', () => {
    const contents = toGeminiContents([
      { role: 'user', content: 'search github' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'anvio_mcp__github__search_code',
            arguments: { query: 'anvio' },
          },
        ],
      },
      {
        role: 'tool',
        name: 'anvio_mcp__github__search_code',
        toolCallId: 'call_1',
        content: '{"hits":1}',
      },
    ]);

    expect(contents[1]).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'call_1',
            name: 'anvio_mcp__github__search_code',
            args: { query: 'anvio' },
          },
        },
      ],
    });
    expect(contents[2]?.parts[0]?.functionResponse).toMatchObject({
      id: 'call_1',
      name: 'anvio_mcp__github__search_code',
    });
  });

  it('extracts tool calls from Gemini parts', () => {
    const calls = extractGeminiToolCalls([
      { functionCall: { name: 'fn', args: { x: 1 }, id: 'id-1' } },
    ]);
    expect(calls).toEqual([{ id: 'id-1', name: 'fn', arguments: { x: 1 } }]);
  });
});
