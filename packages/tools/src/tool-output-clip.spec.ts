import { describe, expect, it } from 'vitest';
import { clipToolOutput, formatToolResultMessage } from './tool-call-parser.js';

describe('clipToolOutput', () => {
  it('returns body unchanged when maxChars is 0', () => {
    const body = 'x'.repeat(20_000);
    expect(clipToolOutput(body, 0)).toBe(body);
  });

  it('returns body unchanged when under limit', () => {
    const body = 'hello world';
    expect(clipToolOutput(body, 8_000)).toBe(body);
  });

  it('keeps head + tail with truncation marker when over limit', () => {
    const body = 'A'.repeat(4_000) + 'MIDDLE_MARKER' + 'B'.repeat(4_000);
    const out = clipToolOutput(body, 100);
    expect(out).toContain('[… ');
    expect(out).toContain('chars truncated …]');
    expect(out.startsWith('A'.repeat(50))).toBe(true);
    expect(out.endsWith('B'.repeat(50))).toBe(true);
    expect(out).not.toContain('MIDDLE_MARKER');
  });

  it('reports correct truncation count', () => {
    const body = 'z'.repeat(10_000);
    const out = clipToolOutput(body, 1_000);
    expect(out).toContain('[… 9000 chars truncated …]');
  });
});

describe('formatToolResultMessage with clip', () => {
  it('does not clip when maxOutputChars omitted', () => {
    const big = 'x'.repeat(20_000);
    const out = formatToolResultMessage('tool', big);
    expect(out).toContain('x'.repeat(20_000));
  });

  it('clips string output when maxOutputChars set', () => {
    const big = 'x'.repeat(20_000);
    const out = formatToolResultMessage('tool', big, undefined, { maxOutputChars: 500 });
    expect(out.length).toBeLessThan(1_500);
    expect(out).toContain('chars truncated');
  });

  it('clips JSON-stringified object output when over limit', () => {
    const bigObj = { data: 'y'.repeat(20_000) };
    const out = formatToolResultMessage('tool', bigObj, undefined, { maxOutputChars: 500 });
    expect(out.length).toBeLessThan(1_500);
    expect(out).toContain('chars truncated');
  });

  it('does not clip error messages', () => {
    const err = 'x'.repeat(20_000);
    const out = formatToolResultMessage('tool', undefined, err, { maxOutputChars: 500 });
    expect(out).toContain('failed');
    expect(out.length).toBeGreaterThan(20_000);
  });
});
