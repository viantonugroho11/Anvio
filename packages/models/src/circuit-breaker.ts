/**
 * Epic 12 F2 slice — per-provider circuit breaker.
 *
 * Tracks consecutive failures per provider id. States:
 * - `closed`: all calls pass. Failures increment counter.
 * - `open`: calls are skipped (routed to next in fallback chain) until `cooldownMs` elapses.
 * - `half-open`: after cooldown, ONE probe call is permitted; success closes, failure re-opens.
 *
 * A "failure" here means a retryable error surfaced by the caller (5xx / 429 / timeout);
 * non-retryable errors do not open the circuit because they represent client bugs, not
 * provider health issues.
 *
 * The breaker is process-local. Distributed enforcement is a substrate-layer story
 * (Epic 0 F2 — Redis / Postgres advisory locks).
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the circuit. Default 3. */
  failureThreshold?: number;
  /** Milliseconds the circuit stays open before a half-open probe is allowed. Default 30_000. */
  cooldownMs?: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

interface Slot {
  state: CircuitState;
  failures: number;
  openedAtMs: number;
}

export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly slots = new Map<string, Slot>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  /** True when a call to `providerId` should be attempted; false to skip and try the next fallback. */
  canAttempt(providerId: string): boolean {
    const slot = this.slots.get(providerId);
    if (!slot) return true;
    if (slot.state === 'closed') return true;
    if (slot.state === 'half-open') return true;
    // open — check cooldown
    if (this.now() - slot.openedAtMs >= this.cooldownMs) {
      slot.state = 'half-open';
      return true;
    }
    return false;
  }

  /** Record a successful call — closes the circuit and resets the failure counter. */
  recordSuccess(providerId: string): void {
    const slot = this.slots.get(providerId);
    if (!slot) return;
    slot.state = 'closed';
    slot.failures = 0;
    slot.openedAtMs = 0;
  }

  /** Record a failure — increments counter; opens circuit when threshold reached. */
  recordFailure(providerId: string): void {
    const slot = this.slots.get(providerId) ?? { state: 'closed', failures: 0, openedAtMs: 0 };
    // half-open failure re-opens immediately (probe failed).
    if (slot.state === 'half-open') {
      slot.state = 'open';
      slot.openedAtMs = this.now();
    } else {
      slot.failures += 1;
      if (slot.failures >= this.failureThreshold) {
        slot.state = 'open';
        slot.openedAtMs = this.now();
      }
    }
    this.slots.set(providerId, slot);
  }

  stateFor(providerId: string): CircuitState {
    return this.slots.get(providerId)?.state ?? 'closed';
  }

  reset(providerId?: string): void {
    if (providerId) {
      this.slots.delete(providerId);
      return;
    }
    this.slots.clear();
  }
}
