import { describe, expect, it } from 'vitest';
import { parseToolCalls, stripToolCalls } from './tool-call-parser.js';

describe('parseToolCalls', () => {
  it('parses fenced anvio_tool blocks', () => {
    const content = [
      'Let me fetch that page.',
      '```anvio_tool',
      '{"name": "anvio_tools__web_fetch", "arguments": {"url": "https://example.com"}}',
      '```',
    ].join('\n');

    const calls = parseToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('anvio_tools__web_fetch');
    expect(calls[0]?.arguments.url).toBe('https://example.com');
  });

  it('strips tool fences from assistant output', () => {
    const content = 'Answer\n```anvio_tool\n{"name":"anvio_tools__file_read","arguments":{"path":"a.md"}}\n```';
    expect(stripToolCalls(content)).toBe('Answer');
  });
});
