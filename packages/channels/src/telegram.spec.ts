import { describe, it, expect } from 'vitest';
import { escapeLeadingSlash } from './telegram.js';

describe('escapeLeadingSlash', () => {
  it('prefixes a leading / with U+200B', () => {
    const out = escapeLeadingSlash('/help');
    expect(out).not.toBe('/help');
    expect(out.endsWith('/help')).toBe(true);
    expect(out.codePointAt(0)).toBe(0x200b);
  });

  it('leaves non-slash text alone', () => {
    expect(escapeLeadingSlash('hello')).toBe('hello');
    expect(escapeLeadingSlash(' /help')).toBe(' /help');
    expect(escapeLeadingSlash('')).toBe('');
  });
});
