import type { ModelToolCall } from './model-tools.js';

export type ChannelType =
  | 'web-chat'
  | 'telegram'
  | 'whatsapp'
  | 'discord'
  | 'slack'
  | 'teams'
  | 'matrix'
  | 'email'
  | 'signal'
  | 'google-chat'
  | 'feishu'
  | 'sms'
  | 'mattermost'
  | 'rest'
  | 'cli';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentRunStatus =
  | 'idle'
  | 'assembling_context'
  | 'calling_model'
  | 'tool_executing'
  | 'awaiting_approval'
  | 'storing_memory'
  | 'completed'
  | 'failed';

export type OrchestrationPattern = 'single' | 'supervisor' | 'parallel' | 'hierarchical';

/**
 * Token counts for one or more model calls.
 *
 * **Invariant: `inputTokens` is the total prompt size and already includes both
 * cache fields.** The cache counts are a breakdown of it, not additions to it —
 * so `inputTokens - cacheReadInputTokens - cacheCreationInputTokens` is the
 * portion billed at full input rate. Costing code that charges `inputTokens`
 * *and* the cache counts bills those tokens twice; use `costInputFromUsage`
 * (`@anvio/models`) to split them into disjoint buckets.
 */
export interface TokenUsage {
  /** Total prompt tokens, inclusive of both cache fields below. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Prompt-cache write tokens (Anthropic ephemeral cache); undefined for providers without caching. */
  cacheCreationInputTokens?: number;
  /** Prompt-cache hit tokens (billed at ~10% of normal input). */
  cacheReadInputTokens?: number;
}

export interface MessageContent {
  type: 'text';
  text: string;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** Tool name when role is tool */
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}
