import { AnvioError } from '@anvio/core';

/**
 * Epic 12 F2 slice — per-tenant/run spend budget with hard-error enforcement.
 *
 * `SpendBudgetLedger` accumulates USD cost per key (tenant, run, agent, or composite)
 * and throws `MODEL_SPEND_BUDGET_EXCEEDED` when `charge()` would push a key over its
 * configured cap. Consumers hold ONE ledger per process; the router/gateway calls
 * `charge(key, usd)` after every model call using the cost estimate from
 * `estimateTokenCostUsd` (or the provider's own reported cost).
 *
 * The ledger is intentionally in-memory. Multi-process budget enforcement is a
 * substrate-layer story (Epic 0 F2 — Postgres ledger with row-level locks).
 */
export class SpendBudgetLedger {
  private readonly spent = new Map<string, number>();
  private readonly caps = new Map<string, number>();

  /** Set a hard USD cap for `key`. Passing `undefined` clears the cap (unlimited). */
  setCap(key: string, capUsd: number | undefined): void {
    if (capUsd == null) {
      this.caps.delete(key);
      return;
    }
    if (capUsd < 0) {
      throw new AnvioError('INVALID_ARGUMENT', `Cap must be non-negative, got ${capUsd}`);
    }
    this.caps.set(key, capUsd);
  }

  /** Charge `usd` against `key`. Throws if the charge would exceed the cap. */
  charge(key: string, usd: number): void {
    if (usd < 0) throw new AnvioError('INVALID_ARGUMENT', `Charge must be non-negative, got ${usd}`);
    const prior = this.spent.get(key) ?? 0;
    const next = prior + usd;
    const cap = this.caps.get(key);
    if (cap != null && next > cap) {
      throw new AnvioError(
        'MODEL_SPEND_BUDGET_EXCEEDED',
        `Spend cap exceeded for "${key}": ${next.toFixed(6)} USD would exceed cap ${cap.toFixed(6)} USD`,
        { details: { key, prior, charge: usd, cap } },
      );
    }
    this.spent.set(key, next);
  }

  /** Current spend for a key. Returns 0 if never charged. */
  spentFor(key: string): number {
    return this.spent.get(key) ?? 0;
  }

  /** Remaining budget for a key. Infinity if no cap set. */
  remaining(key: string): number {
    const cap = this.caps.get(key);
    if (cap == null) return Infinity;
    return Math.max(0, cap - (this.spent.get(key) ?? 0));
  }

  /** Reset one key or all keys (test helper + operator reset). */
  reset(key?: string): void {
    if (key) {
      this.spent.delete(key);
      return;
    }
    this.spent.clear();
  }
}
