import type {
  BuiltinToolResult,
  ChatMessage,
  ModelToolCall,
  RuntimeToolContext,
  RuntimeToolPort,
} from '@anvio/core';
import { formatToolResultMessage } from '@anvio/tools';

const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 8_000;

export const DEFAULT_MAX_TOOL_ITERATIONS = 5;

export function resolveMaxToolOutputChars(): number {
  const raw = process.env.ANVIO_MAX_TOOL_OUTPUT_CHARS;
  if (raw === undefined) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_TOOL_OUTPUT_CHARS;
}

export interface PendingToolApproval {
  requestId: string;
  toolName: string;
  summary: string;
}

/**
 * `native`: the provider returned structured `tool_use` calls; results go back as
 * `role: 'tool'` messages keyed by call id. `parsed`: calls were parsed from fenced
 * `anvio_tool` blocks in the text; results go back as `role: 'user'` messages.
 */
export type ToolCallFormat = 'native' | 'parsed';

export interface ToolRoundInput {
  toolPort: RuntimeToolPort;
  ctx: RuntimeToolContext;
  calls: ModelToolCall[];
  format: ToolCallFormat;
  signal?: AbortSignal;
}

export interface ToolRoundResult {
  /** One message per call, in call order — including calls that did not run. */
  toolMessages: ChatMessage[];
  pendingApproval?: PendingToolApproval;
}

export type ToolRoundEvent = { type: 'progress'; phase: string };

/**
 * Run one round of tool calls sequentially.
 *
 * When a call needs human approval the round stops there, but every call still
 * gets a result message: the ones that ran keep their real results, the one
 * awaiting approval and any after it say they did not run. The two loops this
 * replaces returned only partial results and the runtime then dropped even those
 * from the approval checkpoint, so after resume the model re-ran side effects it
 * had already caused (audit CQ-004).
 */
export async function* executeToolRound(
  input: ToolRoundInput,
): AsyncGenerator<ToolRoundEvent, ToolRoundResult> {
  const { toolPort, ctx, calls, format, signal } = input;
  const maxOutputChars = resolveMaxToolOutputChars();
  const toolMessages: ChatMessage[] = [];
  const message = (call: ModelToolCall, content: string): ChatMessage =>
    format === 'native'
      ? { role: 'tool', name: call.name, toolCallId: call.id, content }
      : { role: 'user', content };

  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]!;
    signal?.throwIfAborted();
    yield { type: 'progress', phase: `Running ${call.name}` };
    const result = await abortable(
      toolPort.call({ name: call.name, arguments: call.arguments }, { ...ctx, signal }),
      signal,
    );

    if (result.status === 'pending_approval') {
      const pendingApproval: PendingToolApproval = {
        requestId: result.approvalRequestId || call.id,
        toolName: call.name,
        summary: approvalSummary(call, result),
      };
      toolMessages.push(
        message(
          call,
          formatToolResultMessage(
            call.name,
            null,
            `Not executed yet: awaiting human approval (${pendingApproval.summary}).`,
          ),
        ),
      );
      for (const skipped of calls.slice(index + 1)) {
        toolMessages.push(
          message(
            skipped,
            formatToolResultMessage(
              skipped.name,
              null,
              `Not executed: ${call.name} in the same batch is awaiting human approval.`,
            ),
          ),
        );
      }
      return { toolMessages, pendingApproval };
    }

    toolMessages.push(
      message(
        call,
        formatToolResultMessage(call.name, result.output, result.error, { maxOutputChars }),
      ),
    );
  }

  return { toolMessages };
}

function approvalSummary(call: ModelToolCall, result: BuiltinToolResult): string {
  if (call.arguments.summary != null) return String(call.arguments.summary);
  if (result.output && typeof result.output === 'object' && 'summary' in result.output) {
    return String((result.output as { summary: unknown }).summary);
  }
  return call.name;
}

/**
 * Settle with the abort reason as soon as `signal` fires. The underlying promise is
 * left to finish on its own — a tool that ignores `ctx.signal` keeps running — but
 * the run no longer waits for it.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
