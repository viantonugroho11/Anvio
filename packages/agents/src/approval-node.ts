import type { ApprovalRequest, ChatMessage, TokenUsage } from '@anvio/core';
import type { PendingToolApproval } from './tool-loop.js';
import type { AgentRunCheckpoint } from './run-checkpoint.js';

export function toApprovalRequest(pending: PendingToolApproval): ApprovalRequest {
  return {
    id: pending.requestId,
    toolName: pending.toolName,
    input: { summary: pending.summary },
    reason: pending.summary,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

export function buildCheckpoint(
  messages: ChatMessage[],
  iteration: number,
  lastIterationContent: string,
  usage: TokenUsage,
  pending: PendingToolApproval,
): Record<string, unknown> {
  const checkpoint: AgentRunCheckpoint = {
    messages,
    iteration,
    lastIterationContent,
    usage,
    approvalRequestId: pending.requestId,
    approvalSummary: pending.summary,
  };
  return checkpoint as unknown as Record<string, unknown>;
}

/** Build the approval_required stream chunk for a suspended tool round. */
export function approvalRequiredChunk(
  pending: PendingToolApproval,
  messages: ChatMessage[],
  nextIteration: number,
  lastIterationContent: string,
  usage: TokenUsage,
) {
  return {
    type: 'approval_required' as const,
    request: toApprovalRequest(pending),
    checkpoint: buildCheckpoint(messages, nextIteration, lastIterationContent, usage, pending),
  };
}
