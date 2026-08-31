import { describe, it, expect } from 'vitest';
import { expandEnvDeep, expandEnvString, MissingEnvError } from './expand-env.js';

describe('expandEnvString', () => {
  it('substitutes a plain ${VAR}', () => {
    expect(expandEnvString('${A}/x', { A: 'one' })).toBe('one/x');
  });

  it('applies :- default when unset or empty', () => {
    expect(expandEnvString('${A:-fallback}', {})).toBe('fallback');
    expect(expandEnvString('${A:-fallback}', { A: '' })).toBe('fallback');
    expect(expandEnvString('${A:-fallback}', { A: 'set' })).toBe('set');
  });

  it('throws with :? message when unset', () => {
    expect(() => expandEnvString('${A:?is required}', {})).toThrow(MissingEnvError);
  });

  it('unset without default becomes empty string', () => {
    expect(expandEnvString('${A}', {})).toBe('');
  });

  it('escapes $${ as literal ${', () => {
    expect(expandEnvString('$${A}', { A: 'one' })).toBe('${A}');
  });

  it('leaves non-placeholder text alone', () => {
    expect(expandEnvString('plain', {})).toBe('plain');
  });
});

describe('expandEnvDeep', () => {
  it('walks arrays and nested objects', () => {
    const env = { HOST: 'db.local', PORT: '5432' };
    const input = {
      command: 'npx',
      args: ['-y', 'server', '${HOST}:${PORT}'],
      env: { URL: 'postgres://${HOST}:${PORT}/x' },
      enabled: true,
      retries: 3,
    };
    expect(expandEnvDeep(input, env)).toEqual({
      command: 'npx',
      args: ['-y', 'server', 'db.local:5432'],
      env: { URL: 'postgres://db.local:5432/x' },
      enabled: true,
      retries: 3,
    });
  });

  it('preserves non-string primitives', () => {
    expect(expandEnvDeep({ a: 1, b: null, c: true }, {})).toEqual({ a: 1, b: null, c: true });
  });
});
