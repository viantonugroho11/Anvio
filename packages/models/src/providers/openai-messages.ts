import type { ChatMessage } from '@anvio/core';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export function toOpenAIMessages(
  request: { systemPrompt?: string; messages: ChatMessage[] },
): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];

  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const message of request.messages) {
    switch (message.role) {
      case 'user':
        messages.push({ role: 'user', content: message.content });
        break;
      case 'assistant': {
        const toolCalls = message.toolCalls ?? [];
        if (toolCalls.length === 0) {
          messages.push({ role: 'assistant', content: message.content });
          break;
        }
        messages.push({
          role: 'assistant',
          content: message.content.trim() ? message.content : null,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        });
        break;
      }
      case 'tool':
        messages.push({
          role: 'tool',
          tool_call_id: message.toolCallId ?? 'unknown',
          content: message.content,
        });
        break;
      case 'system':
        messages.push({ role: 'system', content: message.content });
        break;
      default: {
        const _exhaustive: never = message.role;
        void _exhaustive;
      }
    }
  }

  return messages;
}
