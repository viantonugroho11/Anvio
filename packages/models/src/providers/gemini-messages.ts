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

/**
 * Keys Gemini's OpenAPI-subset `Schema` accepts. Everything else — `$schema`,
 * `$ref`, `$defs`, `additionalProperties`, `oneOf`, `const`, … — is dropped.
 * An allowlist rather than a denylist: tool schemas reaching here include
 * arbitrary JSON Schema from MCP servers (`packages/integrations/src/mcp-tool-port.ts`),
 * so unknown keywords must fail closed.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'anyOf',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

/**
 * Converts a JSON Schema to Gemini's function-declaration subset.
 *
 * Returns `undefined` when the schema carries no parameters Gemini can express —
 * an object with no usable properties. Callers must then omit `parameters`
 * entirely, which is how Gemini represents a no-argument function. Gemini rejects
 * an OBJECT whose `properties` is absent or empty, so passing such a schema
 * through fails the whole request, not just that one tool.
 */
export function toGeminiSchema(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return undefined;

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (GEMINI_SCHEMA_KEYS.has(key)) out[key] = value;
  }

  // JSON Schema allows a type union (`['string','null']`); Gemini wants one type
  // plus `nullable`.
  if (Array.isArray(out.type)) {
    const types = out.type as unknown[];
    if (types.includes('null')) out.nullable = true;
    out.type = types.find((t) => t !== 'null') ?? 'string';
  }

  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const cleaned: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(out.properties as Record<string, unknown>)) {
      const childSchema = toGeminiSchema(child);
      if (childSchema) cleaned[name] = childSchema;
    }
    if (Object.keys(cleaned).length > 0) out.properties = cleaned;
    else delete out.properties;
  }

  if (out.items !== undefined) {
    const items = toGeminiSchema(out.items);
    if (items) out.items = items;
    else delete out.items;
  }

  if (Array.isArray(out.anyOf)) {
    const variants = (out.anyOf as unknown[])
      .map((variant) => toGeminiSchema(variant))
      .filter((variant): variant is Record<string, unknown> => variant !== undefined);
    if (variants.length > 0) out.anyOf = variants;
    else delete out.anyOf;
  }

  // A freeform object — `{ type: 'object' }` with no properties — has no Gemini
  // equivalent. Drop it so the surrounding schema stays valid.
  if (out.type === 'object' && out.properties === undefined) return undefined;

  // `required` may now name a property that was dropped above.
  if (Array.isArray(out.required)) {
    const available = Object.keys((out.properties as Record<string, unknown>) ?? {});
    const kept = (out.required as unknown[]).filter(
      (name): name is string => typeof name === 'string' && available.includes(name),
    );
    if (kept.length > 0) out.required = kept;
    else delete out.required;
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
