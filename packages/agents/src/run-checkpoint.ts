import { z } from 'zod';
import type { ChatMessage, TokenUsage } from '@anvio/core';
import type { PendingToolApproval } from './tool-round.js';

/**
 * Checkpoint persisted in `session.state.metadata.agentRunCheckpoint` when a turn
 * pauses for approval.
 *
 * Version 2 stores the paused assistant turn and every tool result of that round
 * in `messages`. Version 1 (no `version` field) stored only the history before the
 * paused round; it is still readable.
 */
export interface AgentRunCheckpoint {
  version?: 2;
  messages: ChatMessage[];
  iteration: number;
  lastIterationContent: string;
  usage: TokenUsage;
  approvalRequestId: string;
  approvalSummary: string;
}

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

const chatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    name: z.string().optional(),
    toolCallId: z.string().optional(),
    toolCalls: z.array(toolCallSchema).optional(),
  })
  .passthrough();

const usageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
  })
  .passthrough();

const checkpointSchema = z.object({
  version: z.literal(2).optional(),
  messages: z.array(chatMessageSchema),
  iteration: z.number().int().nonnegative(),
  lastIterationContent: z.string().default(''),
  usage: usageSchema,
  approvalRequestId: z.string(),
  approvalSummary: z.string(),
});

export type CheckpointReadResult =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; checkpoint: AgentRunCheckpoint };

/** Validates instead of casting: a corrupt checkpoint must not crash deep in the loop (audit CQ-023). */
export function readRunCheckpoint(metadata?: Record<string, unknown>): CheckpointReadResult {
  const raw = metadata?.agentRunCheckpoint;
  if (raw === undefined || raw === null) return { status: 'absent' };
  const parsed = checkpointSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { status: 'ok', checkpoint: parsed.data as AgentRunCheckpoint };
}

export function buildRunCheckpoint(input: {
  messages: ChatMessage[];
  iteration: number;
  lastIterationContent: string;
  usage: TokenUsage;
  pending: PendingToolApproval;
}): AgentRunCheckpoint {
  return {
    version: 2,
    messages: input.messages,
    iteration: input.iteration,
    lastIterationContent: input.lastIterationContent,
    usage: input.usage,
    approvalRequestId: input.pending.requestId,
    approvalSummary: input.pending.summary,
  };
}
