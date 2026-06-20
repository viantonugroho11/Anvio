import type { ChatMessage, ModelToolCall, RuntimeToolPort } from '@anvio/core';
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
          summary: String(call.arguments.summary ?? ''),
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
