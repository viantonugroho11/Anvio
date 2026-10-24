import type { AgentDefinition, ChannelType, SessionStore, SoulDefinition } from '@anvio/core';
import type { LearningEngine } from '@anvio/learning';
import type { TokenUsageAudit } from '../token-usage-audit.js';

/**
 * Channels that show a picker where /promote and /discard mean something.
 * Kept in sync with CHAT_CHANNELS in gateway-worker.ts — one list per concern
 * (task_completed suppression vs draft-prompt eligibility), currently the same set.
 */
export const CHAT_CHANNELS_FOR_DRAFT_PROMPT: ReadonlySet<string> = new Set([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'web-chat',
  'cli',
  'matrix',
  'teams',
  'mattermost',
]);

export interface AgentRunCompletedEventData {
  sessionId: string;
  content?: string;
  channel?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  provider?: string;
  model?: string;
}

export interface RunCompletedHandlerDeps {
  sessions: Pick<SessionStore, 'get'>;
  loadAgent: (name: string) => Promise<AgentDefinition>;
  tokenUsageAudit: Pick<TokenUsageAudit, 'record'>;
  /** The soul whose evolution policy gates learning for this agent's runs. */
  resolveLearningSoul: (agentId: string) => Promise<SoulDefinition | undefined>;
  learningEngine: Pick<LearningEngine, 'onSessionCompleted'>;
  sendMessage: (
    channel: ChannelType,
    sessionId: string,
    message: { sessionId: string; type: 'done'; content: string },
  ) => Promise<void>;
  /** Provider recorded when neither the event nor the agent names one. */
  fallbackProviderId: string;
  warn?: (message: string, error?: unknown) => void;
}

/**
 * Session-end work after a successful run: token accounting, the learning loop,
 * and an in-channel prompt when the loop drafted a skill.
 *
 * Extracted from `createPlatform`, where it was an inline closure that could only
 * be exercised by booting the whole platform (audit CQ-011).
 */
export function createRunCompletedHandler(deps: RunCompletedHandlerDeps) {
  const warn =
    deps.warn ??
    ((message: string, error?: unknown) =>
      console.warn(message, error instanceof Error ? error.message : (error ?? '')));

  return async (event: { data: unknown }): Promise<void> => {
    const data = event.data as AgentRunCompletedEventData;
    const stored = await deps.sessions.get(data.sessionId);
    if (!stored) return;

    if (data.usage && data.usage.totalTokens > 0) {
      // Prefer who actually served the run (router failover can change it); fall
      // back to the agent's configured provider. Recording the platform default
      // for every run attributed OpenAI/Gemini traffic to Anthropic (audit CQ-019).
      let configured: { provider?: string; model?: string } = {};
      try {
        const agent = await deps.loadAgent(stored.agentName);
        configured = { provider: agent.spec.model.provider, model: agent.spec.model.model };
      } catch (error) {
        warn(`[platform] token audit: agent "${stored.agentName}" not loadable`, error);
      }
      await deps.tokenUsageAudit.record({
        sessionId: stored.id,
        channel: data.channel ?? stored.channel,
        agentId: stored.agentName,
        userId: stored.userId,
        provider: data.provider ?? configured.provider ?? deps.fallbackProviderId,
        model: data.model ?? configured.model,
        usage: data.usage,
      });
    }

    const soul = await deps.resolveLearningSoul(stored.agentName);
    const learningResult = await deps.learningEngine.onSessionCompleted({
      sessionId: stored.id,
      userId: stored.userId,
      agentId: stored.agentName,
      messages: stored.messages,
      soul,
      channel: stored.channel,
    });

    // Prompt the user in-channel when the learning loop produced a draft
    // (issue #56 (b)); otherwise the draft lands silently on disk. Chat channels
    // only — non-chat surfaces have no picker to /promote from.
    const draft = learningResult.skillDraft;
    if (draft && CHAT_CHANNELS_FOR_DRAFT_PROMPT.has(stored.channel)) {
      try {
        await deps.sendMessage(stored.channel as ChannelType, stored.id, {
          sessionId: stored.id,
          type: 'done',
          content: [
            `📝 Skill draft captured: \`${draft.slug}\``,
            '',
            `View: /draft ${draft.slug}`,
            `Save: /promote ${draft.slug}`,
            `Drop: /discard ${draft.slug}`,
          ].join('\n'),
        });
      } catch (error) {
        // Non-fatal — the draft is on disk regardless.
        warn(`[platform] could not announce skill draft in ${stored.channel}`, error);
      }
    }
  };
}
