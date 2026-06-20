import type { ChatMessage, ModelToolCall } from '@anvio/core';

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        out.push({ role: 'user', parts: [{ text: message.content }] });
        break;
      case 'assistant': {
        const parts: GeminiPart[] = [];
        if (message.content.trim()) {
          parts.push({ text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          parts.push({
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.arguments,
            },
          });
        }
        if (parts.length > 0) {
          out.push({ role: 'model', parts });
        }
        break;
      }
      case 'tool': {
        let responsePayload: unknown = message.content;
        try {
          responsePayload = JSON.parse(message.content);
        } catch {
          responsePayload = { result: message.content };
        }
        out.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: message.toolCallId,
                name: message.name ?? 'tool',
                response: responsePayload,
              },
            },
          ],
        });
        break;
      }
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

export function extractGeminiToolCalls(parts: GeminiPart[] | undefined): ModelToolCall[] {
  if (!parts?.length) return [];
  return parts
    .filter((part): part is GeminiPart & { functionCall: NonNullable<GeminiPart['functionCall']> } =>
      Boolean(part.functionCall?.name),
    )
    .map((part, index) => ({
      id: part.functionCall.id ?? `gemini_call_${index}`,
      name: part.functionCall.name,
      arguments: part.functionCall.args ?? {},
    }));
}

export function extractGeminiText(parts: GeminiPart[] | undefined): string {
  if (!parts?.length) return '';
  return parts
    .filter((part): part is GeminiPart & { text: string } => typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}
