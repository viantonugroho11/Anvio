import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ModelToolCall,
  StreamChunk,
} from '@anvio/core';

/** One canned model turn: optional text and/or native tool calls. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Deterministic model for the end-to-end simulator (ADR 0033). Each chat/stream call
 * consumes the next scripted turn; once exhausted it answers with a fixed marker so a
 * scenario that runs past its script fails loudly instead of hanging. Never registered
 * outside simulation mode.
 */
export class ScriptedModelProvider implements ModelProvider {
  readonly providerId = 'scripted';
  readonly supportsNativeTools = true;
  readonly requests: ChatRequest[] = [];
  private cursor = 0;
  private callSeq = 0;

  constructor(private readonly turns: ScriptedTurn[]) {}

  get remaining(): number {
    return this.turns.length - this.cursor;
  }

  private next(request: ChatRequest): { text: string; toolCalls: ModelToolCall[] } {
    this.requests.push(request);
    const turn = this.turns[this.cursor++] ?? { text: '[scripted model: script exhausted]' };
    const toolCalls = (turn.toolCalls ?? []).map((call) => ({
      id: `scripted-${++this.callSeq}`,
      name: call.name,
      arguments: call.arguments ?? {},
    }));
    return { text: turn.text ?? '', toolCalls };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { text, toolCalls } = this.next(request);
    return {
      content: text,
      usage: ZERO_USAGE,
      model: 'scripted',
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const { text, toolCalls } = this.next(request);
    if (text) yield { type: 'text_delta', delta: text };
    for (const toolCall of toolCalls) yield { type: 'tool_use', toolCall };
    yield {
      type: 'done',
      usage: ZERO_USAGE,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    };
  }
}

export function createScriptedModelProvider(turns: ScriptedTurn[]): ScriptedModelProvider {
  return new ScriptedModelProvider(turns);
}
