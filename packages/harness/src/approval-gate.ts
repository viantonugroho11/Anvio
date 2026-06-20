import { randomUUID } from 'node:crypto';
import type { HarnessApprovalContext } from '@anvio/core';
import type { ChannelHubPort, ChannelType } from '@anvio/core';
import { isAuthorizedApprover } from './approver-matcher.js';

export interface ApprovalGateOptions {
  channelHub: ChannelHubPort;
  getApprovers: () => import('@anvio/core').SoulPolicyApprover[];
  approvalTimeoutSeconds?: () => number;
  onTimedOut?: (sessionId: string, requestId: string) => void | Promise<void>;
}

export class ApprovalGate {
  private readonly pending = new Map<string, HarnessApprovalContext & { channel: ChannelType }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: ApprovalGateOptions) {}

  async requestApproval(
    sessionId: string,
    channel: ChannelType,
    summary: string,
    toolName = 'harness_action',
  ): Promise<string> {
    const requestId = randomUUID();
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
    await this.options.onTimedOut?.(sessionId, requestId);
  }

  resolve(requestId: string, userId: string, approved: boolean): boolean {
    const ctx = this.pending.get(requestId);
    if (!ctx || ctx.resolvedAt) return false;

    const ok = isAuthorizedApprover(this.options.getApprovers(), ctx.channel, ctx.summary, userId);
    if (!ok) return false;

    ctx.resolvedAt = new Date().toISOString();
    ctx.approved = approved;
    ctx.resolvedBy = userId;
    this.pending.delete(requestId);

    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
    }

    return true;
  }

  /** @deprecated Use resolve(requestId, userId, true) */
  authorize(requestId: string, userId: string): boolean {
    return this.resolve(requestId, userId, true);
  }

  getContext(requestId: string): HarnessApprovalContext | undefined {
    return this.pending.get(requestId);
  }
}
