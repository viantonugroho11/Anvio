import type { ChatMessage, MemoryProvider, SoulDefinition } from '@anvio/core';
import { SkillEvolutionWriter, type SkillDraftInput } from './skill-evolution.js';
import { MemoryNudgeEngine } from './memory-nudge.js';
import { SessionSummarizer } from './session-summarizer.js';

export interface SessionLearningInput {
  sessionId: string;
  userId: string;
  agentId: string;
  messages: ChatMessage[];
  soul?: SoulDefinition;
}

export interface SessionLearningResult {
  memoryNudge: { factsStored: number; facts: string[] };
  sessionSummary?: { summary: string; stored: boolean };
  skillDraft?: { path: string; slug: string };
  skipped?: string;
}

export class LearningEngine {
  private readonly nudge: MemoryNudgeEngine;
  private readonly skillWriter: SkillEvolutionWriter;
  private readonly summarizer: SessionSummarizer;

  constructor(
    memory: MemoryProvider,
    workspaceRoot: string,
  ) {
    this.nudge = new MemoryNudgeEngine(memory);
    this.skillWriter = new SkillEvolutionWriter(`${workspaceRoot}/skills/_drafts`);
    this.summarizer = new SessionSummarizer(memory);
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
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...input.messages].reverse().find((m) => m.role === 'assistant');

    if (lastUser && lastAssistant && lastUser.content.length > 40) {
      const topic = lastUser.content.slice(0, 80).replace(/\s+/g, ' ').trim();
      const draftInput: SkillDraftInput = {
        slug: input.agentId.replace(/[^a-z0-9-]/gi, '-'),
        sessionId: input.sessionId,
        agentId: input.agentId,
        topic,
        instructions: `Apply this learned pattern when handling similar requests:\n${lastAssistant.content.slice(0, 500)}`,
        sourceExcerpt: lastUser.content.slice(0, 300),
      };
      const draft = await this.skillWriter.proposeDraft(draftInput);
      skillDraft = { path: draft.path, slug: draft.definition.metadata.slug };
    }

    return { memoryNudge, sessionSummary, skillDraft };
  }

  /** Propose skill patch during runtime tool use (L6 — skill self-improve). */
  async proposeFromToolUse(input: {
    sessionId: string;
    agentId: string;
    toolName: string;
    outcome: string;
  }): Promise<{ path: string; slug: string } | undefined> {
    if (input.outcome.length < 20) return undefined;
    const draft = await this.skillWriter.proposeDraft({
      slug: `${input.agentId}-${input.toolName}`.replace(/[^a-z0-9-]/gi, '-'),
      sessionId: input.sessionId,
      agentId: input.agentId,
      topic: `Tool pattern: ${input.toolName}`,
      instructions: `Reuse this approach when calling ${input.toolName}:\n${input.outcome.slice(0, 800)}`,
      sourceExcerpt: input.outcome.slice(0, 300),
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
export { MemoryNudgeEngine } from './memory-nudge.js';
export { SessionSummarizer } from './session-summarizer.js';
