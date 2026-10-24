import { describe, expect, it } from 'vitest';
import {
  ConditionEvaluationError,
  ConditionSyntaxError,
  evaluateConditionExpression as evaluate,
  validateCondition,
} from './condition-expression.js';

describe('evaluateConditionExpression — supported subset', () => {
  const scope = {
    focus: 'security',
    count: 3,
    tags: ['a', 'b'],
    result: { ok: true, files: ['x.ts'], nested: { name: 'Repo' } },
    empty: null,
  };

  it.each([
    ["focus == 'security' || focus == 'all'", true],
    ["focus === 'perf'", false],
    ['count >= 3 && count < 10', true],
    ['!result.ok', false],
    ["tags.includes('b')", true],
    ["result.nested.name.toLowerCase().startsWith('re')", true],
    ['result.files.length > 0', true],
    ['empty?.missing ?? "fallback"', 'fallback'],
    ['empty?.missing.deeper', undefined],
    ['count % 2 === 1 ? "odd" : "even"', 'odd'],
    ['`${focus}-${count}`', 'security-3'],
    ['[1, 2, 3].includes(count)', true],
    ["result['ok']", true],
    ['-count + 5', 2],
    ['"1" == 1', true],
  ])('%s', (expression, expected) => {
    expect(evaluate(expression, scope)).toEqual(expected);
  });
});

describe('evaluateConditionExpression — host isolation', () => {
  it('cannot reach process, globalThis or fetch', () => {
    for (const expression of ['process.env', 'globalThis', 'fetch("https://x")', 'require("fs")']) {
      expect(() => evaluate(expression, {})).toThrow(ConditionEvaluationError);
    }
  });

  it('blocks prototype and constructor walks', () => {
    expect(() => evaluate('a.constructor', { a: {} })).toThrow(/not allowed/);
    expect(() => evaluate("a['__proto__']", { a: {} })).toThrow(/not allowed/);
    expect(() => evaluate('s.constructor.constructor("return process")()', { s: 'x' })).toThrow();
  });

  it('only calls allow-listed string/array methods', () => {
    expect(() => evaluate("s.replace('a', 'b')", { s: 'a' })).toThrow(/not allowed/);
    expect(() => evaluate('o.includes(1)', { o: { includes: () => true } })).toThrow(
      /strings and arrays/,
    );
  });

  it('does not read inherited properties', () => {
    const child = Object.create({ inherited: 'secret' }) as Record<string, unknown>;
    expect(evaluate('o.inherited', { o: child })).toBeUndefined();
  });

  it('treats unknown variables as an evaluation error, like the old evaluator', () => {
    expect(() => evaluate('missing == 1', {})).toThrow(/missing is not defined/);
  });
});

describe('validateCondition', () => {
  it('accepts bundled-skill style conditions', () => {
    expect(validateCondition("scope == 'adr'")).toBeNull();
  });

  it.each(['a ==', 'a = 1', 'a => a', '(a', "'unterminated", 'a; b', 'function () {}()'])(
    'rejects %s',
    (expression) => {
      expect(validateCondition(expression)).not.toBeNull();
    },
  );

  it('throws a syntax error type from parsing', () => {
    expect(() => evaluate('a +', { a: 1 })).toThrow(ConditionSyntaxError);
  });
});
