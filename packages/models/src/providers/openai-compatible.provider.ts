import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ModelToolCall,
  StreamChunk,
} from '@anvio/core';
import { toOpenAIMessages, type OpenAIChatMessage } from './openai-messages.js';

export interface OpenAICompatibleProviderOptions {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
  /** When false, tools are omitted even if the provider supports them. */
  supportsNativeTools?: boolean;
}

interface OpenAIChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function extractToolCalls(toolCalls?: OpenAIToolCall[]): ModelToolCall[] {
  if (!toolCalls?.length) return [];
  return toolCalls.map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseToolCallArguments(call.function.arguments),
  }));
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly providerId: string;
  readonly supportsNativeTools: boolean;
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
    this.supportsNativeTools = options.supportsNativeTools ?? true;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const body: Record<string, unknown> = {
        model: request.model ?? this.defaultModel,
        messages: toOpenAIMessages(request),
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        stream: false,
      };
      if (this.supportsNativeTools && request.tools?.length) {
        body.tools = request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));
      }

      const response = await this.post('/chat/completions', body);
      const responseBody = (await response.json()) as OpenAIChatCompletionResponse;
      if (!response.ok) {
        throw new Error(JSON.stringify(responseBody));
      }

      const message = responseBody.choices?.[0]?.message;
      const toolCalls = extractToolCalls(message?.tool_calls);
      const content = message?.content ?? '';
      const usage = responseBody.usage;

      return {
        content,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        model: responseBody.model ?? request.model ?? this.defaultModel,
        finishReason: responseBody.choices?.[0]?.finish_reason ?? 'stop',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      throw new AnvioError('MODEL_PROVIDER_ERROR', `${this.providerId} API call failed`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    try {
      const body: Record<string, unknown> = {
        model: request.model ?? this.defaultModel,
        messages: toOpenAIMessages(request),
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
        stream: true,
      };
      if (this.supportsNativeTools && request.tools?.length) {
        body.tools = request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));
      }

      const response = await this.post('/chat/completions', body);

      if (!response.ok) {
        const errorBody = await response.text();
        yield { type: 'error', error: errorBody };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'Empty response body' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let streamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

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
            choices?: Array<{ delta?: { content?: string; tool_calls?: OpenAIToolCallDelta[] } }>;
          };

          if (parsed.usage) {
            streamUsage = {
              inputTokens: parsed.usage.prompt_tokens ?? streamUsage.inputTokens,
              outputTokens: parsed.usage.completion_tokens ?? streamUsage.outputTokens,
              totalTokens: parsed.usage.total_tokens ?? streamUsage.totalTokens,
            };
          }

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: 'text_delta', delta: delta.content };
          }

          for (const toolDelta of delta?.tool_calls ?? []) {
            const index = toolDelta.index ?? 0;
            let current = pendingToolCalls.get(index);
            if (!current) {
              current = { id: toolDelta.id ?? '', name: '', arguments: '' };
              pendingToolCalls.set(index, current);
            }
            if (toolDelta.id) current.id = toolDelta.id;
            if (toolDelta.function?.name) current.name = toolDelta.function.name;
            if (toolDelta.function?.arguments) current.arguments += toolDelta.function.arguments;
          }
        }
      }

      const toolCalls: ModelToolCall[] = [];
      for (const pending of pendingToolCalls.values()) {
        if (!pending.id || !pending.name) continue;
        const toolCall: ModelToolCall = {
          id: pending.id,
          name: pending.name,
          arguments: parseToolCallArguments(pending.arguments),
        };
        toolCalls.push(toolCall);
        yield { type: 'tool_use', toolCall };
      }

      yield {
        type: 'done',
        usage: streamUsage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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

export { toOpenAIMessages, type OpenAIChatMessage };
