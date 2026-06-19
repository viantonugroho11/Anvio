import Anthropic from '@anthropic-ai/sdk';
import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamChunk,
} from '@anvio/core';

export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly providerId = 'anthropic';
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
        messages: request.messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const content = textBlock?.type === 'text' ? textBlock.text : '';

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        model: response.model,
        finishReason: response.stop_reason ?? 'end_turn',
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
        messages: request.messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', delta: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'done',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          totalTokens:
            finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export function createModelProvider(
  provider: string,
  apiKey: string,
  model?: string,
): ModelProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey, defaultModel: model });
    default:
      throw new AnvioError('VALIDATION_ERROR', `Unsupported provider: ${provider}`);
  }
}
