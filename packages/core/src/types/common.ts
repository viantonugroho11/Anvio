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
}

export interface MessageContent {
  type: 'text';
  text: string;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
}
