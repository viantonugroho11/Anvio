import type { ChatMessage, MemoryProvider, ModelProvider, SoulDefinition } from '@anvio/core';
import { SkillEvolutionWriter, type SkillDraftInput } from './skill-evolution.js';
import { SkillEvolutionSummarizer } from './skill-evolution-summarizer.js';
import { MemoryNudgeEngine } from './memory-nudge.js';
import { SessionSummarizer } from './session-summarizer.js';
import { SessionSummaryJob, type SessionSummaryJobResult } from './session-summary-job.js';
import type { StaleSessionInput } from './session-summary-job.js';

export interface LearningEngineOptions {
  modelProvider?: ModelProvider;
  /** Optional model override for summarization calls. */
  model?: string;
}

export interface SessionLearningInput {
  sessionId: string;
  userId: string;
  agentId: string;
  messages: ChatMessage[];
  soul?: SoulDefinition;
  /** Chat channel the session ran on. Recorded in draft frontmatter (#56). */
  channel?: string;
}

export interface SessionLearningResult {
  memoryNudge: { factsStored: number; facts: string[] };
  sessionSummary?: { summary: string; stored: boolean; source?: 'llm' | 'rules' };
  skillDraft?: { path: string; slug: string };
  skipped?: string;
}

export class LearningEngine {
  private readonly memory: MemoryProvider;
  private readonly nudge: MemoryNudgeEngine;
  private readonly skillWriter: SkillEvolutionWriter;
  private readonly summarizer: SessionSummarizer;
  private readonly skillSummarizer: SkillEvolutionSummarizer;
  private readonly workspaceRoot: string;
  private readonly summarizerOptions: LearningEngineOptions;

  constructor(
    memory: MemoryProvider,
    workspaceRoot: string,
    options: LearningEngineOptions = {},
  ) {
    this.memory = memory;
    this.workspaceRoot = workspaceRoot;
    this.summarizerOptions = options;
    this.nudge = new MemoryNudgeEngine(memory);
    this.skillWriter = new SkillEvolutionWriter(`${workspaceRoot}/skills/_drafts`);
    this.summarizer = new SessionSummarizer(memory, options);
    this.skillSummarizer = new SkillEvolutionSummarizer(options.modelProvider, options.model);
  }

  async onSessionCompleted(input: SessionLearningInput): Promise<SessionLearningResult> {
    const evolution = input.soul?.spec.evolution;
    if (evolution && !evolution.allowAutoUpdate) {
      return {
        memoryNudge: { factsStored: 0, facts: [] },
        skipped: 'soul evolution disabled',
      };
    }
    // captureOn governs *automatic* drafting (issue #56 (f)). `always` is
    // the previous behavior. `mention` only drafts when the session
    // contains a `/capture` marker. `manual` never drafts here — only the
    // explicit captureFromSession path produces a draft.
    const captureOn = evolution?.captureOn ?? 'always';
    const mentionedCapture = hasCaptureMention(input.messages);
    const shouldAutoDraft =
      captureOn === 'always' || (captureOn === 'mention' && mentionedCapture);

    const memoryNudge = await this.nudge.nudgeFromSession(
      input.sessionId,
      input.userId,
      input.messages,
    );

    const sessionSummary = await this.summarizer.summarizeAndStore(
      input.sessionId,
      input.userId,
      input.messages,
    );

    let skillDraft: SessionLearningResult['skillDraft'];
    const proposal = shouldAutoDraft
      ? await this.skillSummarizer.fromSession({
          sessionId: input.sessionId,
          agentId: input.agentId,
          messages: input.messages,
        })
      : null;

    if (proposal) {
      const draftInput: SkillDraftInput = {
        slug: input.agentId.replace(/[^a-z0-9-]/gi, '-'),
        sessionId: input.sessionId,
        agentId: input.agentId,
        topic: proposal.topic,
        instructions: proposal.instructions,
        sourceExcerpt: proposal.sourceExcerpt,
        description: proposal.description,
        tags: proposal.tags,
        sourceChannel: input.channel,
        sourceUserId: input.userId,
        sourceMessages: input.messages.length,
      };
      const draft = await this.skillWriter.proposeDraft(draftInput);
      skillDraft = { path: draft.path, slug: draft.definition.metadata.slug };
    }

    return { memoryNudge, sessionSummary, skillDraft };
  }

  /** Hermes-style runtime skill evolution after a successful tool call. */
  async onToolUseCompleted(input: {
    sessionId: string;
    agentId: string;
    toolName: string;
    outcome: string;
    soul?: SoulDefinition;
  }): Promise<{ draft?: { path: string; slug: string }; promotedPath?: string; skipped?: string }> {
    const evolution = input.soul?.spec.evolution;
    if (evolution && !evolution.allowAutoUpdate) {
      return { skipped: 'soul evolution disabled' };
    }

    const draft = await this.proposeFromToolUse({
      sessionId: input.sessionId,
      agentId: input.agentId,
      toolName: input.toolName,
      outcome: input.outcome,
    });
    if (!draft) return {};

    if (evolution?.requireApproval === false || evolution?.requireApproval === undefined) {
      const result = await this.promoteDraft(draft.slug, this.workspaceRoot);
      return { draft, promotedPath: result.path };
    }

    return { draft };
  }

  /** Propose skill patch during runtime tool use (L6 — skill self-improve). */
  async proposeFromToolUse(input: {
    sessionId: string;
    agentId: string;
    toolName: string;
    outcome: string;
  }): Promise<{ path: string; slug: string } | undefined> {
    const proposal = await this.skillSummarizer.fromToolUse(input);
    if (!proposal) return undefined;

    const draft = await this.skillWriter.proposeDraft({
      slug: `${input.agentId}-${input.toolName}`.replace(/[^a-z0-9-]/gi, '-'),
      sessionId: input.sessionId,
      agentId: input.agentId,
      topic: proposal.topic,
      instructions: proposal.instructions,
      sourceExcerpt: proposal.sourceExcerpt,
      description: proposal.description,
      tags: proposal.tags,
    });
    return { path: draft.path, slug: draft.definition.metadata.slug };
  }

  listDrafts(): Promise<string[]> {
    return this.skillWriter.listDrafts();
  }

  getDraft(slug: string) {
    return this.skillWriter.getDraft(slug);
  }

  discardDraft(slug: string) {
    return this.skillWriter.discardDraft(slug);
  }

  pruneDrafts(olderThanMs: number) {
    return this.skillWriter.pruneDrafts(olderThanMs);
  }

  /**
   * Promote a draft to workspace/skills. Returns { path, alreadyExisted,
   * diff? }. When the target already exists and differs, the write is
   * refused unless `force: true` and `diff` carries the change so the
   * caller can render it (issue #56 (nice-to-have)).
   */
  promoteDraft(
    slug: string,
    workspaceRoot: string,
    options: { force?: boolean } = {},
  ): Promise<{ path: string; alreadyExisted: boolean; diff?: string }> {
    return this.skillWriter.promoteDraft(slug, `${workspaceRoot}/skills`, options);
  }

  /**
   * Force-extract a draft from a specific session, bypassing
   * `SkillEvolutionSummarizer.shouldCreate`. This is the "human wanted it
   * regardless" path from issue #56 (e) — surfaced as
   * `anvio learning promote-session <sid> --force` and the `/capture`
   * slash command. Returns null when the LLM cannot even scrape a topic.
   */
  async captureFromSession(input: {
    sessionId: string;
    userId: string;
    agentId: string;
    messages: ChatMessage[];
    channel?: string;
    force?: boolean;
  }): Promise<{ path: string; slug: string } | null> {
    const proposal = await this.skillSummarizer.fromSession(
      { sessionId: input.sessionId, agentId: input.agentId, messages: input.messages },
      { force: input.force ?? true },
    );
    if (!proposal) return null;
    const draft = await this.skillWriter.proposeDraft({
      slug: input.agentId.replace(/[^a-z0-9-]/gi, '-'),
      sessionId: input.sessionId,
      agentId: input.agentId,
      topic: proposal.topic,
      instructions: proposal.instructions,
      sourceExcerpt: proposal.sourceExcerpt,
      description: proposal.description,
      tags: proposal.tags,
      sourceChannel: input.channel,
      sourceUserId: input.userId,
      sourceMessages: input.messages.length,
    });
    return { path: draft.path, slug: draft.definition.metadata.slug };
  }

  /**
   * Extract a draft from an offline transcript that never ran inside
   * Anvio (issue #56 nice-to-have). Same shape as captureFromSession
   * with a synthetic session id so lineage still resolves.
   */
  async captureFromTranscript(input: {
    agentId: string;
    messages: ChatMessage[];
    sourceExcerpt?: string;
    sessionId?: string;
  }): Promise<{ path: string; slug: string } | null> {
    const sessionId = input.sessionId ?? `offline-${Date.now()}`;
    return this.captureFromSession({
      sessionId,
      userId: 'offline',
      agentId: input.agentId,
      messages: input.messages,
      force: true,
    });
  }

  async summarizeStaleSessions(
    sessions: StaleSessionInput[],
  ): Promise<SessionSummaryJobResult> {
    const job = new SessionSummaryJob(this.memory, this.summarizerOptions);
    return job.summarizeStaleSessions(sessions);
  }
}

/**
 * True when any message body contains a `/capture` marker (whitespace-
 * separated). Used by the `captureOn: mention` gate — the user asked for
 * this session to be extracted, don't second-guess.
 */
export function hasCaptureMention(messages: ChatMessage[]): boolean {
  return messages.some((m) => /(^|\s)\/capture(\s|$)/i.test(m.content ?? ''));
}

export { SkillEvolutionWriter } from './skill-evolution.js';
export { SkillEvolutionSummarizer } from './skill-evolution-summarizer.js';
export { MemoryNudgeEngine } from './memory-nudge.js';
export { SessionSummarizer } from './session-summarizer.js';
export { SessionSummaryJob, type SessionSummaryJobResult } from './session-summary-job.js';
