import type { BuiltinToolResult, ChatMessage, ModelToolCall, RuntimeToolPort } from '@anvio/core';
import {
  executeParsedToolCalls,
  type PendingToolApproval,
  type ToolLoopCallbacks,
  type ToolLoopContext,
} from './tool-loop.js';
import { executeNativeToolCalls } from './native-tool-loop.js';

export interface ToolRoundInput {
  toolPort: RuntimeToolPort;
  ctx: ToolLoopContext;
  /** Assistant text of this iteration — parsed for fenced tool calls when not using native tools. */
  assistantContent: string;
  /** Native tool_use calls collected from the model stream (native path only). */
  toolCalls: ModelToolCall[];
  useNativeTools: boolean;
  callbacks?: ToolLoopCallbacks;
}

export interface ToolRoundResult {
  /** True when this iteration invoked at least one tool (loop should continue). */
  hadTools: boolean;
  pendingApproval?: PendingToolApproval;
  /** Assistant message to append before the tool results (shape differs per path). */
  assistantMessage: ChatMessage;
  toolMessages: ChatMessage[];
}

/**
 * Single entry point for one tool round — unifies the native tool_use path and
 * the fenced anvio_tool parsing path behind one result shape.
 */
export async function runToolRound(input: ToolRoundInput): Promise<ToolRoundResult> {
  if (input.useNativeTools && input.toolCalls.length > 0) {
    const round = await executeNativeToolCalls({
      toolPort: input.toolPort,
      ctx: input.ctx,
      toolCalls: input.toolCalls,
      callbacks: input.callbacks,
    });
    return {
      hadTools: true,
      pendingApproval: round.pendingApproval,
      assistantMessage: {
        role: 'assistant',
        content: input.assistantContent,
        toolCalls: input.toolCalls,
      },
      toolMessages: round.toolMessages,
    };
  }

  // Native mode with zero tool_use calls falls through to fenced parsing —
  // preserves original runtime behavior for models that emit anvio_tool blocks as text.
  const round = await executeParsedToolCalls({
    toolPort: input.toolPort,
    ctx: input.ctx,
    assistantContent: input.assistantContent,
    callbacks: input.callbacks,
  });
  return {
    hadTools: round.hadTools,
    pendingApproval: round.pendingApproval,
    assistantMessage: { role: 'assistant', content: input.assistantContent },
    toolMessages: round.toolMessages,
  };
}

/** Shared approval summary derivation (was duplicated across both tool paths). */
export function approvalSummaryFromResult(
  call: { name: string; arguments: Record<string, unknown> },
  result: BuiltinToolResult,
): string {
  if (call.arguments.summary != null) {
    return String(call.arguments.summary);
  }
  if (result.output && typeof result.output === 'object' && 'summary' in result.output) {
    return String((result.output as { summary: unknown }).summary);
  }
  return call.name;
}
