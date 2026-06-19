import type { ChannelType } from '../types/common.js';

export interface InboundMessage {
  sessionId: string;
  userId: string;
  content: string;
  channel: ChannelType;
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

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  sendMessage(sessionId: string, message: OutboundMessage): Promise<void>;
  onMessage(handler: InboundMessageHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
