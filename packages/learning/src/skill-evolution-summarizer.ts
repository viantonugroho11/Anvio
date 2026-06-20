import type { ChatMessage, ModelProvider } from '@anvio/core';
import { isUsableModelProvider, parseLlmJson } from './llm-json.js';

export interface SkillEvolutionProposal {
  topic: string;
  instructions: string;
  description: string;
  sourceExcerpt: string;
  tags?: string[];
}

interface LlmSkillProposal {
  shouldCreate?: boolean;
  topic?: string;
  instructions?: string;
  description?: string;
  tags?: string[];
}

const SESSION_SYSTEM_PROMPT = `You extract reusable agent skills from completed sessions.
Respond with ONLY valid JSON (no markdown):
{
  "shouldCreate": boolean,
  "topic": "short skill title",
  "instructions": "actionable markdown instructions the agent should follow next time",
  "description": "one sentence summary",
  "tags": ["learning-loop"]
}
Set shouldCreate=false when there is no clear repeatable pattern, preference, or workflow worth saving.`;

const TOOL_SYSTEM_PROMPT = `You extract reusable tool-usage patterns into agent skills.
Respond with ONLY valid JSON (no markdown):
{
  "shouldCreate": boolean,
  "topic": "short skill title",
  "instructions": "actionable markdown for reusing this tool pattern",
  "description": "one sentence summary",
  "tags": ["learning-loop", "tool-pattern"]
}
Set shouldCreate=false for trivial, one-off, or failed outcomes.`;

export class SkillEvolutionSummarizer {
  constructor(
    private readonly modelProvider?: ModelProvider,
    private readonly model?: string,
  ) {}

  async fromSession(input: {
    sessionId: string;
    agentId: string;
    messages: ChatMessage[];
  }): Promise<SkillEvolutionProposal | null> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...input.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastUser || !lastAssistant || lastUser.content.length < 40) {
      return null;
    }

    const excerpt = formatSessionExcerpt(input.messages);
    const llm = await this.summarizeWithLlm({
      systemPrompt: SESSION_SYSTEM_PROMPT,
      userContent: [
        `Agent: ${input.agentId}`,
        `Session: ${input.sessionId}`,
        '',
        'Conversation excerpt:',
        excerpt,
      ].join('\n'),
    });
    if (llm === null) return null;
    if (llm) return llm;

    return {
      topic: lastUser.content.slice(0, 80).replace(/\s+/g, ' ').trim(),
      instructions: `Apply this learned pattern when handling similar requests:\n${lastAssistant.content.slice(0, 500)}`,
      description: `Learned from session ${input.sessionId}`,
      sourceExcerpt: lastUser.content.slice(0, 300),
      tags: ['draft', 'learning-loop'],
    };
  }

  async fromToolUse(input: {
    sessionId: string;
    agentId: string;
    toolName: string;
    outcome: string;
  }): Promise<SkillEvolutionProposal | null> {
    if (input.outcome.length < 20) return null;

    const llm = await this.summarizeWithLlm({
      systemPrompt: TOOL_SYSTEM_PROMPT,
      userContent: [
        `Agent: ${input.agentId}`,
        `Session: ${input.sessionId}`,
        `Tool: ${input.toolName}`,
        '',
        'Outcome:',
        input.outcome.slice(0, 2000),
      ].join('\n'),
    });
    if (llm === null) return null;
    if (llm) return llm;

    return {
      topic: `Tool pattern: ${input.toolName}`,
      instructions: `Reuse this approach when calling ${input.toolName}:\n${input.outcome.slice(0, 800)}`,
      description: `Tool usage pattern for ${input.toolName}`,
      sourceExcerpt: input.outcome.slice(0, 300),
      tags: ['draft', 'learning-loop', 'tool-pattern'],
    };
  }

  private async summarizeWithLlm(input: {
    systemPrompt: string;
    userContent: string;
  }): Promise<SkillEvolutionProposal | null | undefined> {
    if (!isUsableModelProvider(this.modelProvider)) return undefined;

    try {
      const response = await this.modelProvider!.chat({
        systemPrompt: input.systemPrompt,
        messages: [{ role: 'user', content: input.userContent }],
        maxTokens: 1024,
        temperature: 0.2,
        model: this.model,
      });

      const parsed = parseLlmJson<LlmSkillProposal>(response.content);
      if (parsed?.shouldCreate === false) return null;
      if (!parsed?.shouldCreate || !parsed.topic || !parsed.instructions) {
        return undefined;
      }

      return {
        topic: parsed.topic.trim(),
        instructions: parsed.instructions.trim(),
        description: parsed.description?.trim() ?? parsed.topic.trim(),
        sourceExcerpt: input.userContent.slice(0, 300),
        tags: parsed.tags?.length ? parsed.tags : ['draft', 'learning-loop'],
      };
    } catch {
      return undefined;
    }
  }
}

function formatSessionExcerpt(messages: ChatMessage[], maxMessages = 8): string {
  return messages
    .slice(-maxMessages)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 600)}`)
    .join('\n\n');
}
