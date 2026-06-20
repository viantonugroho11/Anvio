import type { ChatMessage, MemoryProvider, ModelProvider, SoulDefinition } from '@anvio/core';
import { SkillEvolutionWriter, type SkillDraftInput } from './skill-evolution.js';
import { SkillEvolutionSummarizer } from './skill-evolution-summarizer.js';
import { MemoryNudgeEngine } from './memory-nudge.js';
import { SessionSummarizer } from './session-summarizer.js';

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
}

export interface SessionLearningResult {
  memoryNudge: { factsStored: number; facts: string[] };
  sessionSummary?: { summary: string; stored: boolean; source?: 'llm' | 'rules' };
  skillDraft?: { path: string; slug: string };
  skipped?: string;
}

export class LearningEngine {
  private readonly nudge: MemoryNudgeEngine;
  private readonly skillWriter: SkillEvolutionWriter;
  private readonly summarizer: SessionSummarizer;
  private readonly skillSummarizer: SkillEvolutionSummarizer;
  private readonly workspaceRoot: string;

  constructor(
    memory: MemoryProvider,
    workspaceRoot: string,
    options: LearningEngineOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
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
    const proposal = await this.skillSummarizer.fromSession({
      sessionId: input.sessionId,
      agentId: input.agentId,
      messages: input.messages,
    });

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
      const promotedPath = await this.promoteDraft(draft.slug, this.workspaceRoot);
      return { draft, promotedPath };
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

  promoteDraft(slug: string, workspaceRoot: string): Promise<string> {
    return this.skillWriter.promoteDraft(slug, `${workspaceRoot}/skills`);
  }
}

export { SkillEvolutionWriter } from './skill-evolution.js';
export { SkillEvolutionSummarizer } from './skill-evolution-summarizer.js';
export { MemoryNudgeEngine } from './memory-nudge.js';
export { SessionSummarizer } from './session-summarizer.js';
