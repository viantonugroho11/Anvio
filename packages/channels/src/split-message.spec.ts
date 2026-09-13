import { describe, expect, it } from 'vitest';
import { splitMessage } from './split-message.js';

/** Every chunk must be deliverable and nothing may be invented or lost. */
function assertWithin(chunks: string[], maxLen: number) {
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(maxLen);
}

describe('splitMessage', () => {
  it('returns the text untouched when it fits', () => {
    expect(splitMessage('short', 100)).toEqual(['short']);
  });

  it('never cuts a surrogate pair in half (issue #72)', () => {
    // 🙂 is a surrogate pair; place one exactly across the boundary.
    const text = `${'a'.repeat(9)}🙂${'b'.repeat(20)}`;
    const chunks = splitMessage(text, 10);

    assertWithin(chunks, 10);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(chunks.join('')).toContain('🙂');
  });

  it('closes and reopens a code fence across the seam', () => {
    const body = Array.from({ length: 12 }, (_, i) => `line ${i} of code`).join('\n');
    const text = `intro\n\`\`\`ts\n${body}\n\`\`\`\ntail`;

    const chunks = splitMessage(text, 80);

    expect(chunks.length).toBeGreaterThan(1);
    assertWithin(chunks, 80);

    // Every chunk must have balanced fences, or the platform rejects it.
    for (const chunk of chunks) {
      const fences = chunk.split('\n').filter((l) => /^\s*```/.test(l)).length;
      expect(fences % 2).toBe(0);
    }
    // The language survives onto the reopened fence.
    expect(chunks.slice(1).some((c) => c.startsWith('```ts'))).toBe(true);
  });

  it('does not treat an indented inner fence as the closer', () => {
    const text = ['```md', '````', 'nested', '````', '```', 'after'].join('\n');
    expect(splitMessage(text, 1000)).toEqual([text]);
  });

  it('prefers line boundaries over a raw offset', () => {
    const text = ['alpha', 'beta', 'gamma', 'delta'].join('\n');
    const chunks = splitMessage(text, 12);

    assertWithin(chunks, 12);
    for (const chunk of chunks) expect(chunk.startsWith('\n')).toBe(false);
    expect(chunks.join('\n')).toBe(text);
  });

  it('breaks an over-long line at a word boundary when one is near', () => {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    const chunks = splitMessage(text, 20);

    assertWithin(chunks, 20);
    for (const chunk of chunks) expect(chunk).not.toMatch(/^ | $/);
  });

  it('still splits a single unbroken token', () => {
    const chunks = splitMessage('x'.repeat(100), 20);
    assertWithin(chunks, 20);
    expect(chunks.join('')).toBe('x'.repeat(100));
  });

  it('preserves all non-fence content', () => {
    const text = Array.from({ length: 60 }, (_, i) => `row ${i}`).join('\n');
    const chunks = splitMessage(text, 50);

    assertWithin(chunks, 50);
    expect(chunks.join('\n')).toBe(text);
  });

  it('leaves an unbalanced fence in the source as it found it', () => {
    const text = `\`\`\`ts\n${'x'.repeat(10)}`;
    expect(splitMessage(text, 1000)).toEqual([text]);
  });
});
