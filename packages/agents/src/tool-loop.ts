import type { BuiltinToolResult, ChatMessage, RuntimeToolPort } from '@anvio/core';
import { formatToolResultMessage, parseToolCalls } from '@anvio/tools';

const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 8_000;

export function resolveMaxToolOutputChars(): number {
  const raw = process.env.ANVIO_MAX_TOOL_OUTPUT_CHARS;
  if (raw === undefined) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_TOOL_OUTPUT_CHARS;
}

export interface ToolLoopContext {
  sessionId: string;
  agentId: string;
  userId: string;
  channel?: string;
}

export interface ToolLoopCallbacks {
  onProgress?: (phase: string) => void;
}

export async function executeParsedToolCalls(input: {
  toolPort: RuntimeToolPort;
  ctx: ToolLoopContext;
  assistantContent: string;
  callbacks?: ToolLoopCallbacks;
}): Promise<{ toolMessages: ChatMessage[]; hadTools: boolean; toolCallsRun: number; pendingApproval?: PendingToolApproval }> {
  const calls = parseToolCalls(input.assistantContent);
  if (calls.length === 0) {
    return { toolMessages: [], hadTools: false, toolCallsRun: 0 };
  }

  const toolMessages: ChatMessage[] = [];
  for (const call of calls) {
    input.callbacks?.onProgress?.(`Running ${call.name}`);
    const result = await input.toolPort.call(call, input.ctx);
    if (result.status === 'pending_approval') {
      return {
        toolMessages,
        hadTools: true,
        toolCallsRun: calls.length,
        pendingApproval: {
          requestId: result.approvalRequestId ?? '',
          toolName: call.name,
          summary: approvalSummaryFromResult(call, result),
        },
      };
    }
    toolMessages.push({
      role: 'user',
      content: formatToolResultMessage(call.name, result.output, result.error, {
        maxOutputChars: resolveMaxToolOutputChars(),
      }),
    });
  }

  return { toolMessages, hadTools: true, toolCallsRun: calls.length };
}

export interface PendingToolApproval {
  requestId: string;
  toolName: string;
  summary: string;
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 5;

function approvalSummaryFromResult(
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
