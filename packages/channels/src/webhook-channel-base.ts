import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  SessionStore,
} from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';

export interface WebhookChannelOptions {
  sessionBridge: ChannelSessionBridge;
  sessions: SessionStore;
  defaultAgent?: string;
  onApproval?: (sessionId: string, requestId: string, approved: boolean) => Promise<void>;
}

/** Shared in-memory outbound store for webhook-style channel adapters (tests + dry-run). */
export class WebhookChannelStore {
  readonly outbound = new Map<string, OutboundMessage[]>();
  readonly approvals = new Map<string, ApprovalRequestMessage[]>();

  pushMessage(sessionId: string, message: OutboundMessage): void {
    const queue = this.outbound.get(sessionId) ?? [];
    queue.push(message);
    this.outbound.set(sessionId, queue);
  }

  pushApproval(sessionId: string, request: ApprovalRequestMessage): void {
    const queue = this.approvals.get(sessionId) ?? [];
    queue.push(request);
    this.approvals.set(sessionId, queue);
  }

  getMessages(sessionId: string): OutboundMessage[] {
    return this.outbound.get(sessionId) ?? [];
  }

  clear(): void {
    this.outbound.clear();
    this.approvals.clear();
  }
}

export abstract class WebhookChannelAdapter extends BaseChannelAdapter {
  readonly store = new WebhookChannelStore();

  constructor(protected readonly options: WebhookChannelOptions) {
    super();
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    this.store.pushMessage(sessionId, message);
    await this.deliverMessage(sessionId, message);
  }

  protected abstract deliverMessage(sessionId: string, message: OutboundMessage): Promise<void>;

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    this.store.pushApproval(sessionId, request);
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `Approval required: ${request.toolName}\n${request.reason}`,
      metadata: {
        approval: request,
        actions: [
          { id: `approve:${request.requestId}`, label: 'Approve' },
          { id: `reject:${request.requestId}`, label: 'Reject' },
        ],
      },
    });
  }

  async handleInbound(
    sessionId: string,
    userId: string,
    content: string,
    channel: ChannelType,
  ): Promise<void> {
    await this.dispatchInbound({ sessionId, userId, content, channel });
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.store.clear();
  }
}
