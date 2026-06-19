import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamChunk,
} from '@anvio/core';

export interface OpenAICompatibleProviderOptions {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly providerId: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.providerId = options.providerId;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.post('/chat/completions', {
        model: request.model ?? this.defaultModel,
        messages: this.toMessages(request),
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        stream: false,
      });

      const body = (await response.json()) as OpenAIChatCompletionResponse;
      if (!response.ok) {
        throw new Error(JSON.stringify(body));
      }

      const content = body.choices?.[0]?.message?.content ?? '';
      const usage = body.usage;

      return {
        content,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        model: body.model ?? request.model ?? this.defaultModel,
        finishReason: body.choices?.[0]?.finish_reason ?? 'stop',
      };
    } catch (error) {
      throw new AnvioError('MODEL_PROVIDER_ERROR', `${this.providerId} API call failed`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    try {
      const response = await this.post('/chat/completions', {
        model: request.model ?? this.defaultModel,
        messages: this.toMessages(request),
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        stream: true,
      });

      if (!response.ok) {
        const body = await response.text();
        yield { type: 'error', error: body };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'Empty response body' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          const parsed = JSON.parse(data) as OpenAIChatCompletionResponse & {
            choices?: Array<{ delta?: { content?: string } }>;
          };

          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { type: 'text_delta', delta };
          }
        }
      }

      yield {
        type: 'done',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private toMessages(request: ChatRequest): OpenAIChatMessage[] {
    const messages: OpenAIChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    for (const message of request.messages) {
      messages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      });
    }
    return messages;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
}
