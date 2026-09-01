// In-memory pending-mutation store — ADR-0025 track 2.
//
// The chat-native mutation surface (`/new`, `/edit`, `/rm`) posts a preview
// and stashes the intended change here under a short confirm token. The
// user follows up with `/confirm <token>`, and the extras handler resolves
// the token and executes the mutation.
//
// This is a lightweight substitute for the formal harness approval gate
// (which is event-driven and channel-hub-mediated). It is intentionally
// scoped: tokens live only in this process's memory, expire after five
// minutes, and are cleared on `/cancel`. Track 3 will bridge these tokens
// to `harness.recordApproval()` so cross-adapter approvers can act on them
// too, and the pendingMutation shape here is designed to survive that
// upgrade (approvalId is already a field on the audit record).

import { randomBytes } from 'node:crypto';
import type { TrashablePrimitive } from '@anvio/workspace';

export type PendingMutationAction = 'new' | 'edit' | 'rm';

export interface PendingMutation {
  token: string;
  action: PendingMutationAction;
  primitive: TrashablePrimitive;
  slug: string;
  /** Full new body — required for `edit`, optional for `new` (template used when absent). */
  body?: string;
  actor: string;
  channel: string;
  sessionId: string;
  createdAt: number;
  /** ms since epoch. */
  expiresAt: number;
  /** Optional freeform reason the user typed. */
  reason?: string;
}

export interface PendingMutationStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export class PendingMutationStore {
  private readonly items = new Map<string, PendingMutation>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: PendingMutationStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  put(input: Omit<PendingMutation, 'token' | 'createdAt' | 'expiresAt'>): PendingMutation {
    // Six random bytes → 12 hex chars — short enough to type on mobile,
    // wide enough that guessing an active token requires ≈2^48 attempts
    // per five-minute window.
    const token = randomBytes(6).toString('hex');
    const createdAt = this.now();
    const entry: PendingMutation = {
      ...input,
      token,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.items.set(token, entry);
    this.gc();
    return entry;
  }

  take(token: string): PendingMutation | null {
    this.gc();
    const entry = this.items.get(token);
    if (!entry) return null;
    this.items.delete(token);
    return entry;
  }

  cancel(token: string): boolean {
    return this.items.delete(token);
  }

  listForSession(sessionId: string): PendingMutation[] {
    this.gc();
    return [...this.items.values()].filter((e) => e.sessionId === sessionId);
  }

  private gc(): void {
    const now = this.now();
    for (const [token, entry] of this.items) {
      if (entry.expiresAt <= now) this.items.delete(token);
    }
  }
}
