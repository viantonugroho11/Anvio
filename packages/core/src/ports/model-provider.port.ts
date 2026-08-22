import type { ChatMessage, TokenUsage } from '../types/common.js';
import type { ModelToolCall, ModelToolDefinition } from '../types/model-tools.js';

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  tools?: ModelToolDefinition[];
  /** Abort in-flight HTTP/SDK call. Adapters must wire this into fetch/SDK opts. */
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason: string;
  toolCalls?: ModelToolCall[];
}

export type StreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; toolCall: ModelToolCall }
  | {
      type: 'done';
      usage?: TokenUsage;
      toolCalls?: ModelToolCall[];
      /**
       * Raw provider stop reason, passed through unmapped: Anthropic `max_tokens`,
       * OpenAI `length`, Gemini `MAX_TOKENS`. Undefined when the provider did not report one.
       */
      finishReason?: string;
      /**
       * Who actually served the call. Stamped by the router, which may have failed
       * over to a target the caller never named, and left unset by a bare adapter.
       */
      provider?: string;
      model?: string;
    }
  /**
   * The router abandoned one target and continued on another. Emitted before any
   * content, since failover is only possible while nothing has been shown yet —
   * so a surface can tell the user the answer is coming from somewhere else.
   */
  | { type: 'failover'; from: string; to: string; reason?: string }
  | {
      type: 'error';
      error?: string;
      /**
       * Whether another provider is worth trying. Set by the adapter, which still
       * holds the typed SDK exception or HTTP status; consumers must not re-derive
       * it from `error`, which is prose. Undefined means "do not fail over".
       */
      retryable?: boolean;
    };

export interface ModelProvider {
  readonly providerId: string;
  /** When true, provider accepts ChatRequest.tools and emits tool_use stream chunks. */
  readonly supportsNativeTools?: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embeddings?(texts: string[]): Promise<number[][]>;
}

export interface ModelProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}
