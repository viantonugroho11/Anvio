import type { BuiltinToolResult, ChatMessage, ModelToolCall, RuntimeToolPort } from '@anvio/core';
import { formatToolResultMessage } from '@anvio/tools';
import type { ToolLoopCallbacks, ToolLoopContext } from './tool-loop.js';
import type { PendingToolApproval } from './tool-loop.js';

export async function executeNativeToolCalls(input: {
  toolPort: RuntimeToolPort;
  ctx: ToolLoopContext;
  toolCalls: ModelToolCall[];
  callbacks?: ToolLoopCallbacks;
}): Promise<{ toolMessages: ChatMessage[]; toolCallsRun: number; pendingApproval?: PendingToolApproval }> {
  const toolMessages: ChatMessage[] = [];

  for (const call of input.toolCalls) {
    input.callbacks?.onProgress?.(`Running ${call.name}`);
    const result = await input.toolPort.call(
      { name: call.name, arguments: call.arguments },
      input.ctx,
    );
    if (result.status === 'pending_approval') {
      return {
        toolMessages,
        toolCallsRun: input.toolCalls.length,
        pendingApproval: {
          requestId: result.approvalRequestId ?? call.id,
          toolName: call.name,
          summary: approvalSummaryFromResult(call, result),
        },
      };
    }
    toolMessages.push({
      role: 'tool',
      name: call.name,
      toolCallId: call.id,
      content: formatToolResultMessage(call.name, result.output, result.error),
    });
  }

  return { toolMessages, toolCallsRun: input.toolCalls.length };
}

function approvalSummaryFromResult(
  call: ModelToolCall,
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
