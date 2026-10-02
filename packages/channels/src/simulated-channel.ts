import type {
  ApprovalRequestMessage,
  ApprovalResolveOutcome,
  ChannelType,
  OutboundMessage,
} from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import type { ChannelSessionBridge } from './channel-session-bridge.js';

export type SimulatedOutbound =
  | { kind: 'message'; sessionId: string; text: string; metadata?: Record<string, unknown> }
  | { kind: 'approval'; sessionId: string; requestId: string; toolName: string; reason: string };

export interface SimulatedInbound {
  userId: string;
  threadId: string;
  text: string;
  mentionedBot?: boolean;
  mentionedOther?: boolean;
  isDm?: boolean;
}

export interface SimulatedChannelOptions {
  /** Channel this adapter impersonates, so its harness profile and formatting apply. */
  channelType: ChannelType;
  sessionBridge: ChannelSessionBridge;
  /** Agent for new sessions; the bridge's workspace default when omitted. */
  defaultAgent?: string;
  onApproval?: (
    sessionId: string,
    requestId: string,
    approved: boolean,
    userId?: string,
  ) => Promise<ApprovalResolveOutcome>;
}

/**
 * In-memory channel for the end-to-end simulator (ADR 0033). Scenarios push inbound
 * messages and approval clicks; everything the platform sends back lands in `outbox`.
 */
export class SimulatedChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType;
  readonly outbox: SimulatedOutbound[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SimulatedChannelOptions) {
    super();
    this.channelType = options.channelType;
  }

  private record(entry: SimulatedOutbound): void {
    this.outbox.push(entry);
    for (const notify of this.listeners) notify();
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const text = this.resolveOutboundText(sessionId, message);
    if (!text) return;
    this.record({ kind: 'message', sessionId, text, metadata: message.metadata });
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    this.record({
      kind: 'approval',
      sessionId,
      requestId: request.requestId,
      toolName: request.toolName,
      reason: request.reason,
    });
  }

  /** Deliver an inbound message exactly as a real adapter would; returns the session id. */
  async say(input: SimulatedInbound): Promise<string> {
    const session = await this.options.sessionBridge.resolveOrCreate(
      this.channelType,
      input.threadId,
      input.userId,
      this.options.defaultAgent,
    );
    await this.dispatchInbound({
      sessionId: session.id,
      userId: input.userId,
      content: input.text,
      channel: this.channelType,
      channelThreadId: input.threadId,
      metadata: {
        isDm: input.isDm === true,
        mentionedBot: input.mentionedBot === true,
        mentionedOther: input.mentionedOther === true,
      },
    });
    return session.id;
  }

  /** Click approve/reject on a pending approval as `userId`. */
  async decideApproval(
    sessionId: string,
    requestId: string,
    approved: boolean,
    userId: string,
  ): Promise<ApprovalResolveOutcome> {
    if (!this.options.onApproval) return { status: 'not_found' };
    return this.options.onApproval(sessionId, requestId, approved, userId);
  }

  /** Resolve with the first outbox entry matching `predicate`, or reject after `timeoutMs`. */
  waitFor(
    predicate: (entry: SimulatedOutbound) => boolean,
    timeoutMs = 5000,
  ): Promise<SimulatedOutbound> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const hit = this.outbox.find(predicate);
        if (!hit) return false;
        cleanup();
        resolve(hit);
        return true;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SimulatedChannel.waitFor timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.listeners.delete(onRecord);
      };
      const onRecord = (): void => void check();
      if (!check()) this.listeners.add(onRecord);
    });
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.releaseAllBuffers();
    this.listeners.clear();
  }
}
