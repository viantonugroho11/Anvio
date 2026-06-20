import { describe, expect, it } from 'vitest';
import type { ChatMessage, ModelProvider } from '@anvio/core';
import { SkillEvolutionSummarizer } from './skill-evolution-summarizer.js';
import { SessionSummarizer } from './session-summarizer.js';
import { parseLlmJson } from './llm-json.js';

function mockProvider(content: string): ModelProvider {
  return {
    providerId: 'test',
    async chat() {
      return {
        content,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'test',
        finishReason: 'end_turn',
      };
    },
    async *stream() {
      yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  };
}

describe('parseLlmJson', () => {
  it('parses fenced JSON', () => {
    const parsed = parseLlmJson<{ summary: string }>('```json\n{"summary":"hello"}\n```');
    expect(parsed?.summary).toBe('hello');
  });
});

describe('SkillEvolutionSummarizer', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Always include mermaid diagrams in architecture reviews please' },
    { role: 'assistant', content: 'I will add mermaid diagrams to every architecture review.' },
  ];

  it('uses LLM proposal when model is available', async () => {
    const summarizer = new SkillEvolutionSummarizer(
      mockProvider(
        JSON.stringify({
          shouldCreate: true,
          topic: 'Architecture review diagrams',
          instructions: 'Include at least one mermaid diagram in architecture reviews.',
          description: 'User prefers visual architecture reviews.',
          tags: ['learning-loop', 'architecture'],
        }),
      ),
    );

    const proposal = await summarizer.fromSession({
      sessionId: 's1',
      agentId: 'architect',
      messages,
    });

    expect(proposal?.topic).toBe('Architecture review diagrams');
    expect(proposal?.instructions).toContain('mermaid');
  });

  it('returns null when LLM declines skill creation', async () => {
    const summarizer = new SkillEvolutionSummarizer(
      mockProvider(JSON.stringify({ shouldCreate: false })),
    );

    const proposal = await summarizer.fromSession({
      sessionId: 's1',
      agentId: 'architect',
      messages,
    });

    expect(proposal).toBeNull();
  });
});

describe('SessionSummarizer', () => {
  it('stores LLM summary when provider configured', async () => {
    const stored: Array<{ type: string; content: string }> = [];
    const memory = {
      providerId: 'filesystem',
      async store(entry: { type: string; content: string }) {
        stored.push(entry);
      },
      async recall() {
        return [];
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const summarizer = new SessionSummarizer(memory as never, {
      modelProvider: mockProvider(JSON.stringify({ summary: 'User wants diagrams in reviews.' })),
    });

    const result = await summarizer.summarizeAndStore('s1', 'u1', [
      { role: 'user', content: 'Add diagrams' },
      { role: 'assistant', content: 'Done' },
    ]);

    expect(result.source).toBe('llm');
    expect(result.summary).toContain('diagrams');
    expect(stored[0]?.type).toBe('summary');
  });
});
