import { describe, expect, it } from 'vitest';
import { SpendBudgetLedger } from './spend-budget.js';

describe('SpendBudgetLedger', () => {
  it('accumulates spend per key', () => {
    const l = new SpendBudgetLedger();
    l.charge('tenant:acme', 0.25);
    l.charge('tenant:acme', 0.10);
    l.charge('tenant:beta', 0.50);
    expect(l.spentFor('tenant:acme')).toBeCloseTo(0.35);
    expect(l.spentFor('tenant:beta')).toBeCloseTo(0.50);
  });

  it('throws MODEL_SPEND_BUDGET_EXCEEDED when charge would exceed cap', () => {
    const l = new SpendBudgetLedger();
    l.setCap('run:xyz', 1.00);
    l.charge('run:xyz', 0.60);
    expect(() => l.charge('run:xyz', 0.50)).toThrow(/Spend cap exceeded/);
    // Prior charges retained; the failing charge is NOT applied.
    expect(l.spentFor('run:xyz')).toBeCloseTo(0.60);
  });

  it('remaining reports Infinity without a cap', () => {
    const l = new SpendBudgetLedger();
    l.charge('agent:coder', 5);
    expect(l.remaining('agent:coder')).toBe(Infinity);
  });

  it('remaining tracks cap minus spent', () => {
    const l = new SpendBudgetLedger();
    l.setCap('k', 2.00);
    l.charge('k', 1.25);
    expect(l.remaining('k')).toBeCloseTo(0.75);
  });

  it('setCap(undefined) clears the cap', () => {
    const l = new SpendBudgetLedger();
    l.setCap('k', 0.10);
    l.charge('k', 0.05);
    l.setCap('k', undefined);
    l.charge('k', 100); // would have thrown before
    expect(l.spentFor('k')).toBeCloseTo(100.05);
  });

  it('rejects negative charges and caps', () => {
    const l = new SpendBudgetLedger();
    expect(() => l.charge('k', -1)).toThrow(/non-negative/);
    expect(() => l.setCap('k', -0.01)).toThrow(/non-negative/);
  });

  it('reset(key) clears one key only; reset() clears all', () => {
    const l = new SpendBudgetLedger();
    l.charge('a', 1);
    l.charge('b', 2);
    l.reset('a');
    expect(l.spentFor('a')).toBe(0);
    expect(l.spentFor('b')).toBe(2);
    l.reset();
    expect(l.spentFor('b')).toBe(0);
  });
});
