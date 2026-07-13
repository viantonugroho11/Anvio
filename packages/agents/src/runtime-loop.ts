import type {
  ChatMessage,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition,
  RuntimeToolPort,
  TokenUsage,
} from '@anvio/core';
import { addTokenUsage } from '@anvio/core';
import { stripToolCalls } from '@anvio/tools';
import type { ToolLoopContext } from './tool-loop.js';
import { runToolRound } from './tool-executor.js';
import { approvalRequiredChunk } from './approval-node.js';

export interface AgentLoopInput {
  modelProvider: ModelProvider;
  systemPrompt: string;
  messages: ChatMessage[];
  model?: { model?: string; maxTokens?: number; temperature?: number };
  toolPort?: RuntimeToolPort;
  toolCtx: ToolLoopContext;
  useNativeTools: boolean;
  nativeTools?: ModelToolDefinition[];
  startIteration: number;
  maxIterations: number;
  initialUsage: TokenUsage;
  /** Checked between chunks and iterations — true aborts the loop. */
  shouldStop: () => boolean;
  onProgress?: (phase: string) => void;
}

export interface AgentLoopResult {
  /** 'completed' — fullContent is final; 'suspended'/'stopped'/'errored' — caller must not persist. */
  outcome: 'completed' | 'suspended' | 'stopped' | 'errored';
  fullContent: string;
  messages: ChatMessage[];
  usage: TokenUsage;
}

/**
 * The model↔tool iteration loop, extracted from DefaultAgentRuntime.stream().
 * Yields the same chunk union the runtime streams to callers; returns the
 * final state via the generator return value (consume with `yield*`).
 */
export async function* runAgentLoop(input: AgentLoopInput): AsyncGenerator<
  | { type: 'chunk'; delta: string }
  | { type: 'progress'; phase: string; status: 'running' }
  | { type: 'error'; error: string }
  | ReturnType<typeof approvalRequiredChunk>,
  AgentLoopResult
> {
  const { messages, toolPort } = input;
  let usage = input.initialUsage;
  let fullContent = '';
  let lastIterationContent = '';

  const stopped = (): AgentLoopResult => ({
    outcome: 'stopped',
    fullContent,
    messages,
    usage,
  });

  for (let iteration = input.startIteration; iteration < input.maxIterations; iteration++) {
    if (input.shouldStop()) {
      yield { type: 'error', error: 'Session stopped by user' };
      return stopped();
    }

    const phase = iteration === input.startIteration ? 'Calling model' : 'Calling model after tools';
    yield { type: 'progress', phase, status: 'running' };
    input.onProgress?.(phase);

    let iterationContent = '';
    const iterationToolCalls: ModelToolCall[] = [];
    for await (const chunk of input.modelProvider.stream({
      systemPrompt: input.systemPrompt,
      messages,
      maxTokens: input.model?.maxTokens,
      temperature: input.model?.temperature,
      model: input.model?.model,
      tools: input.nativeTools,
    })) {
      if (input.shouldStop()) {
        yield { type: 'error', error: 'Session stopped by user' };
        return stopped();
      }
      if (chunk.type === 'text_delta' && chunk.delta) {
        iterationContent += chunk.delta;
        yield { type: 'chunk', delta: chunk.delta };
      }
      if (chunk.type === 'tool_use') {
        iterationToolCalls.push(chunk.toolCall);
      }
      if (chunk.type === 'done') {
        if (chunk.usage) usage = addTokenUsage(usage, chunk.usage);
        for (const call of chunk.toolCalls ?? []) {
          if (!iterationToolCalls.some((c) => c.id === call.id)) {
            iterationToolCalls.push(call);
          }
        }
      }
      if (chunk.type === 'error') {
        yield { type: 'error', error: chunk.error ?? 'Model stream error' };
        return { outcome: 'errored', fullContent, messages, usage };
      }
    }

    if (!toolPort || toolPort.listTools().length === 0) {
      fullContent = iterationContent;
      break;
    }

    lastIterationContent = iterationContent;

    const round = await runToolRound({
      toolPort,
      ctx: input.toolCtx,
      assistantContent: iterationContent,
      toolCalls: iterationToolCalls,
      useNativeTools: input.useNativeTools,
      callbacks: { onProgress: (p) => input.onProgress?.(p) },
    });

    if (round.pendingApproval) {
      yield approvalRequiredChunk(
        round.pendingApproval,
        messages,
        iteration + 1,
        lastIterationContent,
        usage,
      );
      return { outcome: 'suspended', fullContent, messages, usage };
    }

    if (!round.hadTools) {
      fullContent = iterationContent;
      break;
    }

    messages.push(round.assistantMessage);
    messages.push(...round.toolMessages);
  }

  if (!fullContent) {
    fullContent = stripToolCalls(lastIterationContent);
  }

  return { outcome: 'completed', fullContent, messages, usage };
}
