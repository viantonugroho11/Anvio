import { describe, expect, it } from 'vitest';
import { clipToolOutput, formatToolResultMessage, parseToolCalls, stripToolCalls } from './tool-call-parser.js';

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

describe('clipToolOutput (ADR-0010 L3)', () => {
  it('passes small output through untouched', () => {
    expect(clipToolOutput('small', 100)).toBe('small');
  });

  it('head/tail clips oversized output with an omission marker', () => {
    const big = 'a'.repeat(500) + 'MIDDLE' + 'z'.repeat(500);
    const clipped = clipToolOutput(big, 200);
    expect(clipped.length).toBeLessThan(big.length);
    expect(clipped.startsWith('a'.repeat(140))).toBe(true);
    expect(clipped.endsWith('z'.repeat(60))).toBe(true);
    expect(clipped).toContain('characters omitted');
    expect(clipped).not.toContain('MIDDLE');
  });

  it('0 budget disables clipping', () => {
    const big = 'x'.repeat(100_000);
    expect(clipToolOutput(big, 0)).toBe(big);
  });

  it('formatToolResultMessage clips at the default budget', () => {
    const big = 'y'.repeat(60_000);
    const msg = formatToolResultMessage('file_read', big);
    expect(msg.length).toBeLessThan(35_000);
    expect(msg).toContain('characters omitted');
  });
});
