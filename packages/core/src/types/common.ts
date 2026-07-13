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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Input tokens served from provider prompt cache (billed at reduced rate). */
  cacheReadTokens?: number;
  /** Input tokens written to provider prompt cache. */
  cacheCreationTokens?: number;
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
