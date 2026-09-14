import { randomUUID } from 'node:crypto';
import type { ApprovalResolveOutcome, HarnessApprovalContext } from '@anvio/core';
import type { ChannelHubPort, ChannelType } from '@anvio/core';
import { isAuthorizedApprover } from './approver-matcher.js';

export interface ApprovalGateOptions {
  channelHub: ChannelHubPort;
  getApprovers: () => import('@anvio/core').SoulPolicyApprover[];
  approvalTimeoutSeconds?: () => number;
  onTimedOut?: (sessionId: string, requestId: string) => void | Promise<void>;
}

export interface PendingApprovalRecord {
  requestId: string;
  sessionId: string;
  channel: ChannelType;
  summary: string;
  expiresAt?: Date | string;
}

export class ApprovalGate {
  private readonly pending = new Map<string, HarnessApprovalContext & { channel: ChannelType }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiters = new Map<string, Array<(approved: boolean) => void>>();

  constructor(private readonly options: ApprovalGateOptions) {}

  /**
   * Restore pending approvals from persisted session state on startup.
   * Expired entries are immediately timed out; live ones get fresh timers.
   */
  rehydrate(records: PendingApprovalRecord[]): void {
    const now = Date.now();
    for (const record of records) {
      const expiresAt = record.expiresAt
        ? new Date(record.expiresAt).getTime()
        : 0;

      if (expiresAt > 0 && expiresAt <= now) {
        void this.options.onTimedOut?.(record.sessionId, record.requestId);
        continue;
      }

      const ctx: HarnessApprovalContext & { channel: ChannelType } = {
        requestId: record.requestId,
        sessionId: record.sessionId,
        summary: record.summary,
        createdAt: new Date().toISOString(),
        channel: record.channel,
      };
      this.pending.set(record.requestId, ctx);

      if (expiresAt > 0) {
        const remainingMs = expiresAt - now;
        const timer = setTimeout(() => {
          void this.handleTimeout(record.requestId, record.sessionId);
        }, remainingMs);
        this.timers.set(record.requestId, timer);
      } else {
        this.scheduleTimeout(record.requestId, record.sessionId);
      }
    }
  }

  async requestApproval(
    sessionId: string,
    channel: ChannelType,
    summary: string,
    toolName = 'harness_action',
    existingRequestId?: string,
  ): Promise<string> {
    const requestId = existingRequestId ?? randomUUID();
    const ctx: HarnessApprovalContext & { channel: ChannelType } = {
      requestId,
      sessionId,
      summary,
      createdAt: new Date().toISOString(),
      channel,
    };
    this.pending.set(requestId, ctx);

    await this.options.channelHub.sendApprovalRequest(channel, sessionId, {
      sessionId,
      requestId,
      toolName,
      reason: summary,
      actions: ['approve', 'reject'],
    });

    this.scheduleTimeout(requestId, sessionId);

    return requestId;
  }

  scheduleTimeout(requestId: string, sessionId: string): void {
    const seconds = this.options.approvalTimeoutSeconds?.() ?? 0;
    if (seconds <= 0) return;

    const existing = this.timers.get(requestId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.handleTimeout(requestId, sessionId);
    }, seconds * 1000);
    this.timers.set(requestId, timer);
  }

  private async handleTimeout(requestId: string, sessionId: string): Promise<void> {
    const ctx = this.pending.get(requestId);
    if (!ctx || ctx.resolvedAt) return;
    ctx.resolvedAt = new Date().toISOString();
    ctx.approved = false;
    ctx.resolvedBy = 'system:timeout';
    this.pending.delete(requestId);
    this.timers.delete(requestId);
    this.settleWaiters(requestId, false);
    await this.options.onTimedOut?.(sessionId, requestId);
  }

  waitFor(requestId: string): Promise<boolean> {
    if (!this.pending.has(requestId)) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const list = this.waiters.get(requestId) ?? [];
      list.push(resolve);
      this.waiters.set(requestId, list);
    });
  }

  private settleWaiters(requestId: string, approved: boolean): void {
    const list = this.waiters.get(requestId);
    if (!list) return;
    this.waiters.delete(requestId);
    for (const resolve of list) resolve(approved);
  }

  resolve(requestId: string, userId: string, approved: boolean): ApprovalResolveOutcome {
    const ctx = this.pending.get(requestId);
    if (!ctx) return { status: 'not_found' };
    if (ctx.resolvedAt) return { status: 'already_resolved' };

    const ok = isAuthorizedApprover(this.options.getApprovers(), ctx.channel, ctx.summary, userId);
    if (!ok) return { status: 'not_authorized' };

    ctx.resolvedAt = new Date().toISOString();
    ctx.approved = approved;
    ctx.resolvedBy = userId;
    this.pending.delete(requestId);

    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
    }

    this.settleWaiters(requestId, approved);

    return { status: 'resolved' };
  }

  /** @deprecated Use resolve(requestId, userId, true) */
  authorize(requestId: string, userId: string): ApprovalResolveOutcome {
    return this.resolve(requestId, userId, true);
  }

  getContext(requestId: string): HarnessApprovalContext | undefined {
    return this.pending.get(requestId);
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
