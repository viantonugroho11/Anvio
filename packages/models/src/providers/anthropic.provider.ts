import Anthropic from '@anthropic-ai/sdk';
import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ModelToolCall,
  StreamChunk,
} from '@anvio/core';
import { toAnthropicMessages } from './anthropic-messages.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
  /** Tag system prompt + tool definitions with cache_control (default true). */
  promptCache?: boolean;
}

/** Build the `system` param, tagging it as a cacheable block when enabled (ADR-0010 layer 2). */
export function toAnthropicSystem(
  systemPrompt: string | undefined,
  promptCache: boolean,
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return systemPrompt;
  if (!promptCache) return systemPrompt;
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
}

/** Map tool definitions, tagging the last one as a cache breakpoint when enabled. */
export function toAnthropicTools(
  tools: ChatRequest['tools'],
  promptCache: boolean,
): Anthropic.Messages.Tool[] | undefined {
  const mapped: Anthropic.Messages.Tool[] | undefined = tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));
  if (mapped && mapped.length > 0 && promptCache) {
    mapped[mapped.length - 1] = {
      ...mapped[mapped.length - 1],
      cache_control: { type: 'ephemeral' },
    };
  }
  return mapped;
}

function extractCacheUsage(usage: Anthropic.Messages.Usage): {
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
} {
  return {
    ...(usage.cache_read_input_tokens ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens
      ? { cacheCreationTokens: usage.cache_creation_input_tokens }
      : {}),
  };
}

function extractToolCalls(content: Anthropic.Messages.ContentBlock[]): ModelToolCall[] {
  return content
    .filter((block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input as Record<string, unknown>,
    }));
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export class AnthropicProvider implements ModelProvider {
  readonly providerId = 'anthropic';
  readonly supportsNativeTools = true;
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly promptCache: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.defaultModel ?? 'claude-sonnet-4-20250514';
    this.promptCache = options.promptCache ?? true;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.client.messages.create({
        model: request.model ?? this.defaultModel,
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        system: toAnthropicSystem(request.systemPrompt, this.promptCache),
        messages: toAnthropicMessages(request.messages),
        tools: toAnthropicTools(request.tools, this.promptCache),
      });

      const toolCalls = extractToolCalls(response.content);
      const content = extractText(response.content);

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          ...extractCacheUsage(response.usage),
        },
        model: response.model,
        finishReason: response.stop_reason ?? 'end_turn',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      throw new AnvioError('MODEL_PROVIDER_ERROR', 'Anthropic API call failed', {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    try {
      const stream = this.client.messages.stream({
        model: request.model ?? this.defaultModel,
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        system: toAnthropicSystem(request.systemPrompt, this.promptCache),
        messages: toAnthropicMessages(request.messages),
        tools: toAnthropicTools(request.tools, this.promptCache),
      });

      let currentToolId: string | null = null;
      let currentToolName = '';
      let toolInputJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          toolInputJson = '';
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'input_json_delta' &&
          currentToolId
        ) {
          toolInputJson += event.delta.partial_json;
        }
        if (event.type === 'content_block_stop' && currentToolId) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolInputJson || '{}') as Record<string, unknown>;
          } catch {
            args = {};
          }
          yield {
            type: 'tool_use',
            toolCall: { id: currentToolId, name: currentToolName, arguments: args },
          };
          currentToolId = null;
          currentToolName = '';
          toolInputJson = '';
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', delta: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      const toolCalls = extractToolCalls(finalMessage.content);
      yield {
        type: 'done',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          totalTokens:
            finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          ...extractCacheUsage(finalMessage.usage),
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
