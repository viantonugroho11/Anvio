import { randomUUID } from 'node:crypto';
import type {
  BuiltinToolCall,
  BuiltinToolResult,
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
import {
  createHarnessOutputPort,
  createHarnessToolHandlers,
  type OutputPortDeps,
} from './output-port.js';
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
  onApprovalTimedOut?: (sessionId: string, requestId: string) => void | Promise<void>;
}

export class HarnessGateway implements HarnessGatewayPort {
  readonly enabled: boolean;
  readonly defaults: HarnessDefaults;
  readonly policy: SoulPolicy;

  private readonly profiles: HarnessChannelProfile[];
  private readonly channelHub: ChannelHubPort;
  private readonly sessions: SessionStore;
  private readonly engagementStore: EngagementStore;
  private readonly approvalGate: ApprovalGate;
  private readonly resumeTracker: SessionResumeTracker;
  private readonly deliveredReplies = new Set<string>();
  readonly connectBroker?: ConnectionBroker;

  constructor(options: HarnessGatewayOptions) {
    this.enabled = options.defaults.enabled;
    this.defaults = options.defaults;
    this.policy = options.policy;
    this.profiles = options.profiles;
    this.channelHub = options.channelHub;
    this.sessions = options.sessions;
    this.engagementStore = options.engagementStore ?? new MemoryEngagementStore();
    this.resumeTracker = new SessionResumeTracker(options.sessions, options.defaults.idleMinutes);
    this.connectBroker = options.connectBroker;

    this.approvalGate = new ApprovalGate({
      channelHub: this.channelHub,
      getApprovers: () => this.policy.approvers,
      approvalTimeoutSeconds: () => this.policy.approvalTimeoutSeconds,
      onTimedOut: options.onApprovalTimedOut,
    });
  }

  async handleInbound(envelope: InboundEnvelope): Promise<InboundGateResult> {
    if (!this.enabled) {
      return { decision: 'allow', envelope, sessionId: envelope.sessionId };
    }

    if (isUserBlocked(this.policy, envelope.channel, envelope.userId)) {
      debugDrop(envelope, 'blocked_user');
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
      debugDrop(envelope, 'restricted_zone', { trustTier, dmPolicy: profile.dmPolicy, isDm });
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
      debugDrop(envelope, 'not_engaged', {
        engageOn: profile.engageOn,
        mentionedBot: envelope.mentionedBot,
      });
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

  resetReplyTracking(sessionId: string): void {
    this.deliveredReplies.delete(sessionId);
  }

  hasDeliveredReply(sessionId: string): boolean {
    return this.deliveredReplies.has(sessionId);
  }

  private outputPortDeps(): OutputPortDeps {
    return {
      channelHub: this.channelHub,
      policy: () => this.policy,
      approvalGate: this.approvalGate,
      redact: (text) => this.redact(text),
    };
  }

  createOutputPort(sessionId: string, channel: ChannelType): HarnessOutputPort {
    return createHarnessOutputPort(sessionId, channel, this.outputPortDeps());
  }

  /** Channel-agnostic harness tools (reply, request_approval, …) for agent runtime. */
  async callChannelTool(
    call: BuiltinToolCall,
    ctx: { sessionId: string; channel: ChannelType; userId?: string },
  ): Promise<BuiltinToolResult> {
    if (!this.enabled) {
      return { name: call.name, output: null, status: 'skipped', error: 'Harness disabled' };
    }

    if (call.name === 'anvio_channel__request_approval') {
      const summary = String(call.arguments.summary ?? '');
      const requestId = await this.approvalGate.requestApproval(
        ctx.sessionId,
        ctx.channel,
        summary,
        call.name,
      );

      const timeoutSec = this.policy.approvalTimeoutSeconds;
      const expiresAt = new Date(
        Date.now() + (timeoutSec > 0 ? timeoutSec * 1000 : 86_400_000),
      );

      await this.sessions.update(ctx.sessionId, {
        pendingApproval: {
          id: requestId,
          toolName: call.name,
          input: call.arguments,
          reason: summary,
          expiresAt,
        },
        status: 'awaiting_approval',
      });

      return {
        name: call.name,
        output: {
          requestId,
          channel: ctx.channel,
          message: 'Approval request sent to channel. Await human decision.',
        },
        status: 'pending_approval',
        approvalRequestId: requestId,
      };
    }

    const handlers = createHarnessToolHandlers(ctx.sessionId, ctx.channel, this.outputPortDeps());
    const handler = handlers[call.name];
    if (!handler) {
      return { name: call.name, output: null, status: 'skipped', error: 'Unknown channel tool' };
    }

    try {
      const output = await handler(call.arguments);
      if (call.name === 'anvio_channel__reply') {
        this.deliveredReplies.add(ctx.sessionId);
      }
      return { name: call.name, output, status: 'completed' };
    } catch (error) {
      return {
        name: call.name,
        output: null,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Register an approval a runtime raised on its own (an `approval_required`
   * stream event) so it lands on the channel with native Approve/Reject
   * controls and resolves through the same approver policy and timeout as
   * tool-initiated ones. The runtime's request id is reused verbatim —
   * `resolve` and `session.pendingApproval.id` must agree (issue #68).
   */
  async registerRuntimeApproval(
    sessionId: string,
    channel: ChannelType,
    request: { requestId: string; toolName: string; reason: string },
  ): Promise<void> {
    await this.approvalGate.requestApproval(
      sessionId,
      channel,
      request.reason,
      request.toolName,
      request.requestId,
    );
  }

  /**
   * Ask for approval and block until a human answers (or the policy timeout
   * fires). Used by runtimes that gate their own tool execution and keep
   * the call open rather than checkpointing the turn — see
   * `RuntimeApprovalPort` and issue #69.
   *
   * `inlineApprovalRequestId` marks the session so the APPROVAL_DECIDED
   * consumer does not also re-dispatch the run: the original turn is still
   * alive and about to continue on its own.
   */
  async requestApprovalAndWait(
    sessionId: string,
    channel: ChannelType,
    summary: string,
    toolName: string,
    input: Record<string, unknown> = {},
  ): Promise<boolean> {
    // Mint the id up front and persist the awaiting state BEFORE the
    // prompt reaches the channel: a human who answers instantly would
    // otherwise race the write, and the session would be left marked
    // awaiting_approval after the decision had already cleared it.
    const requestId = randomUUID();
    const timeoutSec = this.policy.approvalTimeoutSeconds;
    const stored = await this.sessions.get(sessionId);
    await this.sessions.update(sessionId, {
      status: 'awaiting_approval',
      pendingApproval: {
        id: requestId,
        toolName,
        input,
        reason: summary,
        expiresAt: new Date(Date.now() + (timeoutSec > 0 ? timeoutSec * 1000 : 86_400_000)),
      },
      metadata: { ...stored?.metadata, inlineApprovalRequestId: requestId },
    });

    await this.approvalGate.requestApproval(sessionId, channel, summary, toolName, requestId);

    const approved = await this.approvalGate.waitFor(requestId);

    const after = await this.sessions.get(sessionId);
    const metadata = { ...after?.metadata };
    delete metadata.inlineApprovalRequestId;
    await this.sessions.update(sessionId, {
      status: 'calling_model',
      pendingApproval: undefined,
      metadata,
    });

    return approved;
  }

  listChannelTools(): string[] {
    if (!this.enabled) return [];
    return [
      'anvio_channel__reply',
      'anvio_channel__edit',
      'anvio_channel__set_status',
      'anvio_channel__request_approval',
    ];
  }

  async authorizeApproval(sessionId: string, requestId: string, userId: string): Promise<boolean> {
    void sessionId;
    return this.approvalGate.resolve(requestId, userId, true);
  }

  async resolveApproval(
    sessionId: string,
    requestId: string,
    userId: string,
    approved: boolean,
  ): Promise<boolean> {
    const stored = await this.sessions.get(sessionId);
    const ok = this.approvalGate.resolve(requestId, userId, approved);
    if (!ok) return false;

    // An inline approval's own turn clears the session once it wakes up
    // (`requestApprovalAndWait`). Writing here too would race that clear —
    // both patches are read-modify-write, so the loser resurrects the
    // pending state it just cleared.
    if (stored?.metadata?.inlineApprovalRequestId !== requestId) {
      await this.sessions.update(sessionId, { pendingApproval: undefined });
    }
    return true;
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

/**
 * Emit a single line for a dropped inbound. Silent drops behind a "healthy"
 * channel status were the worst possible failure mode on the Telegram path
 * (issues #51 and #52) — every user who hit them assumed the token, the
 * network, or the bot config was wrong and lost hours before finding the
 * decision inside this gate. Gated by ANVIO_HARNESS_DEBUG to keep the
 * default log quiet.
 */
function debugDrop(
  envelope: InboundEnvelope,
  reason: string,
  extra?: Record<string, unknown>,
): void {
  if (!process.env.ANVIO_HARNESS_DEBUG) return;
  const detail = extra ? ` ${JSON.stringify(extra)}` : '';
  console.warn(
    `[harness] drop ${reason} channel=${envelope.channel} thread=${envelope.threadId} user=${envelope.userId}${detail}`,
  );
}
