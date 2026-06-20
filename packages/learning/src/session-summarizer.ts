import type { ChatMessage, MemoryProvider, ModelProvider } from '@anvio/core';
import { isUsableModelProvider, parseLlmJson } from './llm-json.js';

export interface SessionSummaryResult {
  summary: string;
  stored: boolean;
  source?: 'llm' | 'rules';
}

const SESSION_SUMMARY_SYSTEM = `Summarize this agent session for cross-session memory recall.
Respond with ONLY valid JSON:
{
  "summary": "2-4 sentences covering user goals, key decisions, and outcomes"
}
Keep it factual and compact.`;

export interface SessionSummarizerOptions {
  modelProvider?: ModelProvider;
  model?: string;
}

/** Session summarizer — LLM when available, rule-based fallback. */
export class SessionSummarizer {
  constructor(
    private readonly memory: MemoryProvider,
    private readonly options: SessionSummarizerOptions = {},
  ) {}

  async summarize(messages: ChatMessage[]): Promise<{ summary: string; source: 'llm' | 'rules' }> {
    const llm = await this.summarizeWithLlm(messages);
    if (llm) return { summary: llm, source: 'llm' };
    return { summary: this.summarizeWithRules(messages), source: 'rules' };
  }

  summarizeWithRules(messages: ChatMessage[]): string {
    const userMsgs = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const assistantMsgs = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    if (userMsgs.length === 0) return '';

    const topics = userMsgs.slice(-3).map((m) => m.slice(0, 120).replace(/\s+/g, ' ').trim());
    const lastReply = assistantMsgs.at(-1)?.slice(0, 280).replace(/\s+/g, ' ').trim() ?? '';

    return [
      `Topics: ${topics.join(' | ')}`,
      lastReply ? `Last outcome: ${lastReply}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async summarizeAndStore(
    sessionId: string,
    userId: string,
    messages: ChatMessage[],
  ): Promise<SessionSummaryResult> {
    const { summary, source } = await this.summarize(messages);
    if (!summary) return { summary: '', stored: false, source };

    await this.memory.store({
      sessionId,
      userId,
      type: 'summary',
      content: summary,
    });

    return { summary, stored: true, source };
  }

  private async summarizeWithLlm(messages: ChatMessage[]): Promise<string | null> {
    const provider = this.options.modelProvider;
    if (!isUsableModelProvider(provider) || messages.length === 0) return null;

    const excerpt = messages
      .slice(-10)
      .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
      .join('\n\n');

    try {
      const response = await provider!.chat({
        systemPrompt: SESSION_SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: excerpt }],
        maxTokens: 512,
        temperature: 0.2,
        model: this.options.model,
      });
      const parsed = parseLlmJson<{ summary?: string }>(response.content);
      const summary = parsed?.summary?.trim();
      return summary || null;
    } catch {
      return null;
    }
  }
}
