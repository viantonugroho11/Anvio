import type { ChatMessage, TokenUsage } from '../types/common.js';
import type { ModelToolCall, ModelToolDefinition } from '../types/model-tools.js';

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  tools?: ModelToolDefinition[];
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
  | { type: 'done'; usage?: TokenUsage; toolCalls?: ModelToolCall[] }
  | { type: 'error'; error?: string };

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
