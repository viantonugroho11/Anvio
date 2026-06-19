import type { ChatMessage, TokenUsage } from '../types/common.js';

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason: string;
}

export interface StreamChunk {
  type: 'text_delta' | 'done' | 'error';
  delta?: string;
  usage?: TokenUsage;
  error?: string;
}

export interface ModelProvider {
  readonly providerId: string;
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
