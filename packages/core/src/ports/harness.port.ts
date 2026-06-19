import type { ChannelType } from '../types/common.js';
import type { ApprovalRequestMessage } from '../types/channel.js';
import type { SoulPolicy } from '../schemas/soul-policy.schema.js';
import type { HarnessDefaults } from '../schemas/harness.schema.js';

export type HarnessTrustTier = 'trusted' | 'allowed' | 'restricted';

export type InboundDecision = 'allow' | 'drop' | 'disengage';

export interface InboundEnvelope {
  channel: ChannelType;
  threadId: string;
  userId: string;
  content: string;
  sessionId?: string;
  zoneId?: string;
  mentionedBot?: boolean;
  mentionedOther?: boolean;
  trustTier?: HarnessTrustTier;
  metadata?: Record<string, unknown>;
}

export interface InboundGateResult {
  decision: InboundDecision;
  reason?: string;
  envelope: InboundEnvelope;
  sessionId?: string;
}

export type HarnessOutputAction =
  | 'reply'
  | 'edit'
  | 'upload'
  | 'react'
  | 'unreact'
  | 'setStatus'
  | 'requestApproval';

export interface HarnessOutputRequest {
  sessionId: string;
  channel: ChannelType;
  action: HarnessOutputAction;
  text?: string;
  messageId?: string;
  emoji?: string;
  filePath?: string;
  fileName?: string;
  approvalSummary?: string;
  status?: string;
}

export interface HarnessOutputPort {
  reply(sessionId: string, text: string): Promise<void>;
  edit(sessionId: string, messageId: string, text: string): Promise<void>;
  setStatus(sessionId: string, status: string): Promise<void>;
  requestApproval(sessionId: string, summary: string): Promise<string>;
}

export interface HarnessGatewayPort {
  readonly enabled: boolean;
  readonly defaults: HarnessDefaults;
  readonly policy: SoulPolicy;

  handleInbound(envelope: InboundEnvelope): Promise<InboundGateResult>;
  shouldSuppressRawOutput(channel: ChannelType): boolean;
  createOutputPort(sessionId: string, channel: ChannelType): HarnessOutputPort;
  authorizeApproval(sessionId: string, requestId: string, userId: string): Promise<boolean>;
  formatOutbound(channel: ChannelType, markdown: string): string;
  redact(text: string): string;
  recordSessionActivity(sessionId: string): Promise<void>;
  isSessionIdle(sessionId: string, now?: Date): Promise<boolean>;
}

export interface HarnessApprovalContext {
  requestId: string;
  sessionId: string;
  summary: string;
  createdAt: string;
  resolvedAt?: string;
  approved?: boolean;
  resolvedBy?: string;
}

export type HarnessApprovalMessage = ApprovalRequestMessage & {
  summary: string;
};
