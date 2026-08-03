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
  /** Ephemeral prompt caching on system prompt + last tool def. Default true. */
  promptCaching?: boolean;
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

type AnthropicUsage = Anthropic.Messages.Usage & {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

function usageFromAnthropic(usage: AnthropicUsage) {
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cacheCreate + cacheRead;
  return {
    inputTokens,
    outputTokens: usage.output_tokens,
    totalTokens: inputTokens + usage.output_tokens,
    cacheCreationInputTokens: cacheCreate || undefined,
    cacheReadInputTokens: cacheRead || undefined,
  };
}

function buildSystem(
  systemPrompt: string | undefined,
  cache: boolean,
): string | Array<Anthropic.Messages.TextBlockParam> | undefined {
  if (!systemPrompt) return undefined;
  if (!cache) return systemPrompt;
  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

function buildTools(
  tools: ChatRequest['tools'] | undefined,
  cache: boolean,
): Anthropic.Messages.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool, index) => {
    const base: Anthropic.Messages.Tool = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
    };
    if (cache && index === tools.length - 1) {
      return { ...base, cache_control: { type: 'ephemeral' } };
    }
    return base;
  });
}

export class AnthropicProvider implements ModelProvider {
  readonly providerId = 'anthropic';
  readonly supportsNativeTools = true;
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly promptCaching: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.defaultModel ?? 'claude-sonnet-4-20250514';
    this.promptCaching = options.promptCaching ?? true;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.client.messages.create({
        model: request.model ?? this.defaultModel,
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        system: buildSystem(request.systemPrompt, this.promptCaching),
        messages: toAnthropicMessages(request.messages),
        tools: buildTools(request.tools, this.promptCaching),
      });

      const toolCalls = extractToolCalls(response.content);
      const content = extractText(response.content);

      return {
        content,
        usage: usageFromAnthropic(response.usage as AnthropicUsage),
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
        system: buildSystem(request.systemPrompt, this.promptCaching),
        messages: toAnthropicMessages(request.messages),
        tools: buildTools(request.tools, this.promptCaching),
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
        usage: usageFromAnthropic(finalMessage.usage as AnthropicUsage),
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
