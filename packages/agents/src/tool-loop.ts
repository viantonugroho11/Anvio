import type { ChatMessage, RuntimeToolPort } from '@anvio/core';
import { formatToolResultMessage, parseToolCalls } from '@anvio/tools';

export interface ToolLoopContext {
  sessionId: string;
  agentId: string;
  userId: string;
}

export interface ToolLoopCallbacks {
  onProgress?: (phase: string) => void;
}

export async function executeParsedToolCalls(input: {
  toolPort: RuntimeToolPort;
  ctx: ToolLoopContext;
  assistantContent: string;
  callbacks?: ToolLoopCallbacks;
}): Promise<{ toolMessages: ChatMessage[]; hadTools: boolean; toolCallsRun: number }> {
  const calls = parseToolCalls(input.assistantContent);
  if (calls.length === 0) {
    return { toolMessages: [], hadTools: false, toolCallsRun: 0 };
  }

  const toolMessages: ChatMessage[] = [];
  for (const call of calls) {
    input.callbacks?.onProgress?.(`Running ${call.name}`);
    const result = await input.toolPort.call(call, input.ctx);
    toolMessages.push({
      role: 'user',
      content: formatToolResultMessage(call.name, result.output, result.error),
    });
  }

  return { toolMessages, hadTools: true, toolCallsRun: calls.length };
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 5;
