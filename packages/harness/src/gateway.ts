import type {
  ChannelHubPort,
  ChannelType,
  HarnessDefaults,
  HarnessGatewayPort,
  HarnessOutputPort,
  InboundEnvelope,
  InboundGateResult,
  SessionStore,
  SoulPolicy,
} from '@anvio/core';
import { ApprovalGate } from './approval-gate.js';
import { resolveChannelProfile } from './config-loader.js';
import { evaluateEngagement, MemoryEngagementStore, type EngagementStore } from './engagement.js';
import { formatForChannel } from './format/index.js';
import {
  canAccessRestrictedZone,
  isUserBlocked,
  resolveTrustTier,
} from './policy-enforcer.js';
import { createHarnessOutputPort, type OutputPortDeps } from './output-port.js';
import { isAuthorizedApprover } from './approver-matcher.js';
import { SessionResumeTracker } from './session-resume.js';
import type { HarnessChannelProfile } from '@anvio/core';
import type { ConnectionBroker } from './connect/broker.js';

export interface HarnessGatewayOptions {
  defaults: HarnessDefaults;
  profiles: HarnessChannelProfile[];
  policy: SoulPolicy;
  channelHub: ChannelHubPort;
  sessions: SessionStore;
  engagementStore?: EngagementStore;
  connectBroker?: ConnectionBroker;
}

export class HarnessGateway implements HarnessGatewayPort {
  readonly enabled: boolean;
  readonly defaults: HarnessDefaults;
  readonly policy: SoulPolicy;

  private readonly profiles: HarnessChannelProfile[];
  private readonly channelHub: ChannelHubPort;
  private readonly engagementStore: EngagementStore;
  private readonly approvalGate: ApprovalGate;
  private readonly resumeTracker: SessionResumeTracker;
  readonly connectBroker?: ConnectionBroker;

  constructor(options: HarnessGatewayOptions) {
    this.enabled = options.defaults.enabled;
    this.defaults = options.defaults;
    this.policy = options.policy;
    this.profiles = options.profiles;
    this.channelHub = options.channelHub;
    this.engagementStore = options.engagementStore ?? new MemoryEngagementStore();
    this.resumeTracker = new SessionResumeTracker(options.sessions, options.defaults.idleMinutes);
    this.connectBroker = options.connectBroker;

    this.approvalGate = new ApprovalGate(this.channelHub, () => this.policy.approvers);
  }

  async handleInbound(envelope: InboundEnvelope): Promise<InboundGateResult> {
    if (!this.enabled) {
      return { decision: 'allow', envelope, sessionId: envelope.sessionId };
    }

    if (isUserBlocked(this.policy, envelope.channel, envelope.userId)) {
      return { decision: 'drop', reason: 'blocked_user', envelope };
    }

    const profile = resolveChannelProfile(this.profiles, envelope.channel);
    const zoneId = envelope.zoneId ?? envelope.threadId;
    const trustTier = envelope.trustTier ?? resolveTrustTier(this.policy, envelope.channel, zoneId);
    const isDm = envelope.metadata?.isDm === true;

    const allowed = canAccessRestrictedZone(
      this.policy,
      envelope.channel,
      envelope.userId,
      trustTier,
      profile.dmPolicy,
      isDm,
    );
    if (!allowed) {
      return { decision: 'drop', reason: 'restricted_zone', envelope };
    }

    const currentEngagement = await this.engagementStore.get(envelope.channel, envelope.threadId);
    const engaged = evaluateEngagement(profile, currentEngagement, {
      mentionedBot: envelope.mentionedBot,
      mentionedOther: envelope.mentionedOther,
    });

    await this.engagementStore.set({
      channel: envelope.channel,
      threadId: envelope.threadId,
      engaged,
      updatedAt: new Date().toISOString(),
    });

    if (!engaged && profile.engageOn !== 'always') {
      return { decision: 'disengage', reason: 'not_engaged', envelope };
    }

    if (envelope.sessionId) {
      await this.resumeTracker.recordActivity(envelope.sessionId);
    }

    return { decision: 'allow', envelope, sessionId: envelope.sessionId };
  }

  shouldSuppressRawOutput(channel: ChannelType): boolean {
    if (!this.enabled || !this.defaults.suppressRawOutput) return false;
    return !['cli', 'rest', 'web-chat'].includes(channel);
  }

  createOutputPort(sessionId: string, channel: ChannelType): HarnessOutputPort {
    const deps: OutputPortDeps = {
      channelHub: this.channelHub,
      policy: () => this.policy,
      approvalGate: this.approvalGate,
      redact: (text) => this.redact(text),
    };
    return createHarnessOutputPort(sessionId, channel, deps);
  }

  async authorizeApproval(sessionId: string, requestId: string, userId: string): Promise<boolean> {
    void sessionId;
    return this.approvalGate.authorize(requestId, userId);
  }

  formatOutbound(channel: ChannelType, markdown: string): string {
    return formatForChannel(channel, this.redact(markdown));
  }

  redact(text: string): string {
    let out = text;
    for (const pattern of this.policy.redactPatterns) {
      try {
        out = out.replace(new RegExp(pattern, 'gi'), '[REDACTED]');
      } catch {
        // skip invalid regex
      }
    }
    return out;
  }

  async recordSessionActivity(sessionId: string): Promise<void> {
    await this.resumeTracker.recordActivity(sessionId);
  }

  async isSessionIdle(sessionId: string, now?: Date): Promise<boolean> {
    return this.resumeTracker.isIdle(sessionId, now);
  }

  authorizeApprover(channel: ChannelType, summary: string, userId: string): boolean {
    return isAuthorizedApprover(this.policy.approvers, channel, summary, userId);
  }
}

export function createHarnessGateway(options: HarnessGatewayOptions): HarnessGateway {
  return new HarnessGateway(options);
}
