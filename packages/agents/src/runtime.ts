import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  ApprovalDecision,
  ChatMessage,
  ModelProvider,
  Session,
  TokenUsage,
  UserInput,
} from '@anvio/core';
import type { MemoryStore } from '@anvio/core';
import type { SoulService } from '@anvio/souls';
import { PersonaService } from '@anvio/personas';
import { SkillRegistry } from '@anvio/skills';

export interface AgentRuntimeDeps {
  personaService: PersonaService;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  modelProvider: ModelProvider;
  soulService?: SoulService;
  onProgress?: (sessionId: string, phase: string) => void;
}

export class DefaultAgentRuntime implements AgentRuntime {
  private readonly stopRequests = new Set<string>();

  constructor(private readonly deps: AgentRuntimeDeps) {}

  async stop(sessionId: string): Promise<void> {
    this.stopRequests.add(sessionId);
  }

  async run(session: Session, agent: AgentDefinition, input: UserInput): Promise<AgentResult> {
    let content = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    for await (const chunk of this.stream(session, agent, input)) {
      if (chunk.type === 'chunk' && chunk.delta) content += chunk.delta;
      if (chunk.type === 'done' && chunk.usage) usage = chunk.usage;
      if (chunk.type === 'error') throw new Error(chunk.error);
    }

    return { sessionId: session.id, content, usage, status: 'completed' };
  }

  async *stream(session: Session, agent: AgentDefinition, input: UserInput) {
    if (this.stopRequests.has(session.id)) {
      this.stopRequests.delete(session.id);
      yield { type: 'error' as const, error: 'Session stopped by user' };
      return;
    }

    try {
      yield { type: 'progress' as const, phase: 'Assembling context', status: 'running' as const };
      this.deps.onProgress?.(session.id, 'Assembling context');

      const systemPrompt = await this.assembleSystemPrompt(agent, session.userId);
      const memoryContext = await this.deps.memoryStore.getContext(session.id, session.userId);
      const messages: ChatMessage[] = [
        ...memoryContext.shortTerm,
        { role: 'user', content: input.content },
      ];

      await this.deps.memoryStore.storeConversation(session.id, session.userId, [
        { role: 'user', content: input.content },
      ]);

      yield { type: 'progress' as const, phase: 'Calling model', status: 'running' as const };
      this.deps.onProgress?.(session.id, 'Calling model');

      let fullContent = '';
      for await (const chunk of this.deps.modelProvider.stream({
        systemPrompt,
        messages,
        maxTokens: agent.spec.model.maxTokens,
        temperature: agent.spec.model.temperature,
        model: agent.spec.model.model,
      })) {
        if (this.stopRequests.has(session.id)) {
          this.stopRequests.delete(session.id);
          yield { type: 'error' as const, error: 'Session stopped by user' };
          return;
        }
        if (chunk.type === 'text_delta' && chunk.delta) {
          fullContent += chunk.delta;
          yield { type: 'chunk' as const, delta: chunk.delta };
        }
        if (chunk.type === 'done' && chunk.usage) {
          yield { type: 'progress' as const, phase: 'Storing memory', status: 'running' as const };
          await this.deps.memoryStore.storeConversation(session.id, session.userId, [
            ...messages,
            { role: 'assistant', content: fullContent },
          ]);
          yield { type: 'progress' as const, phase: 'Completed', status: 'completed' as const };
          yield { type: 'done' as const, usage: chunk.usage };
        }
        if (chunk.type === 'error') {
          yield { type: 'error' as const, error: chunk.error };
        }
      }
    } catch (error) {
      yield {
        type: 'error' as const,
        error: error instanceof Error ? error.message : 'Agent runtime error',
      };
    }
  }

  async resume(
    session: Session,
    agent: AgentDefinition,
    _approval: ApprovalDecision,
  ): Promise<AgentResult> {
    return this.run(session, agent, { content: 'Continue after approval.' });
  }

  private async assembleSystemPrompt(agent: AgentDefinition, userId: string): Promise<string> {
    const [persona, skillSpecs] = await Promise.all([
      this.deps.personaService.getBySlug(agent.spec.persona),
      this.deps.skillRegistry.getBySlugs(agent.spec.skills),
    ]);

    const personaPrompt = this.deps.personaService.renderSystemPrompt(persona);
    const skillPrompt = this.deps.skillRegistry.renderSkillInstructions(skillSpecs);

    const parts = [personaPrompt, skillPrompt];

    const soulSlug = agent.spec.soul;
    if (soulSlug && this.deps.soulService) {
      try {
        const soulContext = await this.deps.soulService.loadContext(soulSlug, userId);
        parts.push(this.deps.soulService.renderSoulContext(soulContext));
      } catch {
        // Soul optional — fall back to persona-only context
      }
    }

    return parts.filter(Boolean).join('\n\n---\n\n');
  }
}

export * from './orchestrator.js';
