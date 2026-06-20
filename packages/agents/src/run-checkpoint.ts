import type { ChatMessage, TokenUsage } from '@anvio/core';

export interface AgentRunCheckpoint {
  messages: ChatMessage[];
  iteration: number;
  lastIterationContent: string;
  usage: TokenUsage;
  approvalRequestId: string;
  approvalSummary: string;
}

export function readRunCheckpoint(metadata?: Record<string, unknown>): AgentRunCheckpoint | undefined {
  const raw = metadata?.agentRunCheckpoint;
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as AgentRunCheckpoint;
}
