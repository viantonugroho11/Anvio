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
import { PersonaService } from '@anvio/personas';
import { SkillRegistry } from '@anvio/skills';

export interface AgentRuntimeDeps {
  personaService: PersonaService;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  modelProvider: ModelProvider;
}

export class DefaultAgentRuntime implements AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}

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

  async *stream(
    session: Session,
    agent: AgentDefinition,
    input: UserInput,
  ): AsyncIterable<{
    type: 'chunk' | 'done' | 'error';
    delta?: string;
    usage?: TokenUsage;
    error?: string;
  }> {
    try {
      const systemPrompt = await this.assembleSystemPrompt(agent);
      const memoryContext = await this.deps.memoryStore.getContext(session.id, session.userId);
      const messages: ChatMessage[] = [
        ...memoryContext.shortTerm,
        { role: 'user', content: input.content },
      ];

      await this.deps.memoryStore.storeConversation(session.id, session.userId, [
        { role: 'user', content: input.content },
      ]);

      let fullContent = '';
      for await (const chunk of this.deps.modelProvider.stream({
        systemPrompt,
        messages,
        maxTokens: agent.spec.model.maxTokens,
        temperature: agent.spec.model.temperature,
        model: agent.spec.model.model,
      })) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          fullContent += chunk.delta;
          yield { type: 'chunk', delta: chunk.delta };
        }
        if (chunk.type === 'done' && chunk.usage) {
          await this.deps.memoryStore.storeConversation(session.id, session.userId, [
            ...messages,
            { role: 'assistant', content: fullContent },
          ]);
          yield { type: 'done', usage: chunk.usage };
        }
        if (chunk.type === 'error') {
          yield { type: 'error', error: chunk.error };
        }
      }
    } catch (error) {
      yield {
        type: 'error',
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

  private async assembleSystemPrompt(agent: AgentDefinition): Promise<string> {
    const [persona, skillSpecs] = await Promise.all([
      this.deps.personaService.getBySlug(agent.spec.persona),
      this.deps.skillRegistry.getBySlugs(agent.spec.skills),
    ]);

    const personaPrompt = this.deps.personaService.renderSystemPrompt(persona);
    const skillPrompt = this.deps.skillRegistry.renderSkillInstructions(skillSpecs);

    return [personaPrompt, skillPrompt].filter(Boolean).join('\n\n---\n\n');
  }
}

export * from './runtime.js';
