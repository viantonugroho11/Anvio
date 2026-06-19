import type { ChatMessage, MemoryProvider, SoulDefinition } from '@anvio/core';
import { SkillEvolutionWriter, type SkillDraftInput } from './skill-evolution.js';
import { MemoryNudgeEngine } from './memory-nudge.js';

export interface SessionLearningInput {
  sessionId: string;
  userId: string;
  agentId: string;
  messages: ChatMessage[];
  soul?: SoulDefinition;
}

export interface SessionLearningResult {
  memoryNudge: { factsStored: number; facts: string[] };
  skillDraft?: { path: string; slug: string };
  skipped?: string;
}

export class LearningEngine {
  private readonly nudge: MemoryNudgeEngine;
  private readonly skillWriter: SkillEvolutionWriter;

  constructor(
    memory: MemoryProvider,
    workspaceRoot: string,
  ) {
    this.nudge = new MemoryNudgeEngine(memory);
    this.skillWriter = new SkillEvolutionWriter(`${workspaceRoot}/skills/_drafts`);
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

    return { memoryNudge, skillDraft };
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
