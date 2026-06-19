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
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
