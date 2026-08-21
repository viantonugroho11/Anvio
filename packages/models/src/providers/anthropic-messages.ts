import type Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage } from '@anvio/core';

type AnthropicMessage = Anthropic.Messages.MessageParam;
type ContentBlock = Anthropic.Messages.ContentBlockParam;

export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        out.push({ role: 'user', content: message.content });
        break;
      case 'assistant': {
        // Anthropic rejects a conversation opening on an assistant turn. Injected
        // context (a compressed-history summary) can land first — carry it as user
        // context rather than losing the turn to a 400.
        if (out.length === 0 && !message.toolCalls?.length) {
          out.push({ role: 'user', content: message.content });
          break;
        }
        const blocks: ContentBlock[] = [];
        if (message.content.trim()) {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        out.push({
          role: 'assistant',
          content: blocks.length === 1 && blocks[0]?.type === 'text' ? message.content : blocks,
        });
        break;
      }
      case 'tool':
        out.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId ?? 'unknown',
              content: message.content,
            },
          ],
        });
        break;
      case 'system':
        break;
      default: {
        const _exhaustive: never = message.role;
        void _exhaustive;
      }
    }
  }

  return out;
}
