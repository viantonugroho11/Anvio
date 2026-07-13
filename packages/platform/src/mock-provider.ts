import type { ModelProvider } from '@anvio/core';

/** Fallback provider when no model API key is configured. */
export function createMockModelProvider(): ModelProvider {
  return {
    providerId: 'mock',
    async chat(request) {
      const last = request.messages.at(-1)?.content ?? '';
      return {
        content: `[Mock — set a model API key] You said: ${last}`,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'mock',
        finishReason: 'end_turn',
      };
    },
    async *stream(request) {
      const last = request.messages.at(-1)?.content ?? '';
      const text = `[Mock — set a model API key] You said: ${last}`;
      yield { type: 'text_delta', delta: text };
      yield {
        type: 'done',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}
