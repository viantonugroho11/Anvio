import { describe, it, expect } from 'vitest';
import { escapeLeadingSlash, buildTelegramCommandList } from './telegram.js';

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

describe('buildTelegramCommandList', () => {
  it('accepts [a-z0-9_]{1,32} names unchanged', () => {
    const out = buildTelegramCommandList([
      { name: 'help', description: 'Show help' },
      { name: 'setup_token', description: 'OAuth' },
    ]);
    expect(out).toEqual([
      { command: 'help', description: 'Show help' },
      { command: 'setup_token', description: 'OAuth' },
    ]);
  });

  it('sanitises dashes/dots/whitespace/mixed case', () => {
    const out = buildTelegramCommandList([
      { name: 'providers-test', description: 'probe' },
      { name: 'History.Branch', description: 'tree' },
      { name: 'set my commands', description: 'ws' },
    ]);
    expect(out.map((c) => c.command)).toEqual([
      'providers_test',
      'history_branch',
      'set_my_commands',
    ]);
  });

  it('drops non-syncable entries', () => {
    const out = buildTelegramCommandList([
      { name: 'help', description: 'ok' },
      { name: 'confirm', description: 'token-only', syncable: false },
    ]);
    expect(out.map((c) => c.command)).toEqual(['help']);
  });

  it('skips names that sanitise to empty', () => {
    const out = buildTelegramCommandList([
      { name: '---', description: 'x' },
      { name: '', description: 'y' },
    ]);
    expect(out).toEqual([]);
  });

  it('truncates at 32 chars', () => {
    const long = 'a'.repeat(40);
    const [only] = buildTelegramCommandList([{ name: long, description: 'x' }]);
    expect(only.command.length).toBe(32);
  });

  it('dedupes by sanitised name', () => {
    const out = buildTelegramCommandList([
      { name: 'foo-bar', description: 'first' },
      { name: 'foo_bar', description: 'dup' },
    ]);
    expect(out).toEqual([{ command: 'foo_bar', description: 'first' }]);
  });

  it('strips a leading digit so names satisfy the API pattern', () => {
    const [entry] = buildTelegramCommandList([{ name: '1cmd', description: 'x' }]);
    expect(entry.command).toBe('cmd');
  });

  it('truncates long descriptions to <=96 chars', () => {
    const desc = 'x'.repeat(120);
    const [entry] = buildTelegramCommandList([{ name: 'foo', description: desc }]);
    expect(entry.description.length).toBeLessThanOrEqual(96);
    expect(entry.description.endsWith('...')).toBe(true);
  });
});
