import { randomUUID } from 'node:crypto';
import type { HarnessApprovalContext } from '@anvio/core';
import type { ChannelHubPort, ChannelType } from '@anvio/core';
import { isAuthorizedApprover } from './approver-matcher.js';

export class ApprovalGate {
  private readonly pending = new Map<string, HarnessApprovalContext & { channel: ChannelType }>();

  constructor(
    private readonly channelHub: ChannelHubPort,
    private readonly getApprovers: () => import('@anvio/core').SoulPolicyApprover[],
  ) {}

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

    await this.channelHub.sendApprovalRequest(channel, sessionId, {
      sessionId,
      requestId,
      toolName,
      reason: summary,
      actions: ['approve', 'reject'],
    });

    return requestId;
  }

  authorize(requestId: string, userId: string): boolean {
    const ctx = this.pending.get(requestId);
    if (!ctx || ctx.resolvedAt) return false;
    const ok = isAuthorizedApprover(this.getApprovers(), ctx.channel, ctx.summary, userId);
    if (ok) {
      ctx.resolvedAt = new Date().toISOString();
      ctx.approved = true;
      ctx.resolvedBy = userId;
    }
    return ok;
  }

  getContext(requestId: string): HarnessApprovalContext | undefined {
    return this.pending.get(requestId);
  }
}
