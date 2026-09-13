import type { ChannelType } from '../types/common.js';
import type {
  AgentNotification,
  ApprovalRequestMessage,
  ProgressUpdate,
} from '../types/channel.js';

export interface InboundMessage {
  sessionId: string;
  userId: string;
  content: string;
  channel: ChannelType;
  /** Maps external thread/topic to agent session */
  channelThreadId?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  sessionId: string;
  content?: string;
  delta?: string;
  type: 'message' | 'chunk' | 'done' | 'error';
  error?: string;
  metadata?: Record<string, unknown>;
}

export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;

/**
 * ChannelAdapter — transport layer only.
 * Agent Runtime never imports channel-specific code.
 * New channels (Teams, Matrix, Line, Signal) implement this interface.
 */
export interface ChannelAdapter {
  readonly channelType: ChannelType;
  sendMessage(sessionId: string, message: OutboundMessage): Promise<void>;
  sendProgress?(sessionId: string, update: ProgressUpdate): Promise<void>;
  sendNotification?(sessionId: string, notification: AgentNotification): Promise<void>;
  sendApprovalRequest?(sessionId: string, request: ApprovalRequestMessage): Promise<void>;
  /**
   * Toggle the channel's native "working on it" indicator (Telegram's
   * sendChatAction, Slack's typing event, …). Optional — adapters without
   * one simply omit it. Implementations must be idempotent and must not
   * leak timers: the worker calls it once when a turn starts and once when
   * it ends, including on the failure path (issue #70).
   */
  setTyping?(sessionId: string, active: boolean): Promise<void>;
  onMessage(handler: InboundMessageHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ChannelHubPort {
  register(adapter: ChannelAdapter): void;
  getAdapter(channel: ChannelType): ChannelAdapter | undefined;
  sendMessage(channel: ChannelType, sessionId: string, message: OutboundMessage): Promise<void>;
  sendProgress(channel: ChannelType, sessionId: string, update: ProgressUpdate): Promise<void>;
  sendNotification(
    channel: ChannelType,
    sessionId: string,
    notification: AgentNotification,
  ): Promise<void>;
  sendApprovalRequest(
    channel: ChannelType,
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void>;
  /** Forwards to the adapter's `setTyping` when it has one; no-op otherwise. */
  setTyping?(channel: ChannelType, sessionId: string, active: boolean): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
