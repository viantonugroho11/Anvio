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

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.defaultModel ?? 'claude-sonnet-4-20250514';
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.client.messages.create({
        model: request.model ?? this.defaultModel,
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
        })),
      });

      const toolCalls = extractToolCalls(response.content);
      const content = extractText(response.content);

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
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
        system: request.systemPrompt,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
        })),
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
