import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ModelToolCall,
  StreamChunk,
} from '@anvio/core';
import { toOpenAIMessages, type OpenAIChatMessage } from './openai-messages.js';
import { withCallMetrics, recordStreamMetrics } from '../metrics-emitter.js';
import { httpErrorChunk, httpProviderError, toErrorChunk, toProviderError } from '../provider-error.js';

export interface OpenAICompatibleProviderOptions {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
  /** When false, tools are omitted even if the provider supports them. */
  supportsNativeTools?: boolean;
  /** Completions path appended to `baseUrl`. Defaults to `/chat/completions`. */
  path?: string;
  /** Hard ceiling applied to every request's `max_tokens`, whatever the caller asked for. */
  maxOutputTokens?: number;
}

const DEFAULT_MAX_TOKENS = 8192;

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

/**
 * A single `data:` frame of a streaming completion. Distinct from the non-stream
 * response: choices carry `delta` rather than `message`, and any OpenAI-compatible
 * host may replace the frame entirely with an `error` object mid-stream.
 */
interface OpenAIStreamFrame {
  model?: string;
  choices?: Array<{
    delta?: { content?: string; tool_calls?: OpenAIToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
}

function formatStreamFrameError(error: NonNullable<OpenAIStreamFrame['error']>): string {
  const parts = [error.message ?? 'Provider returned an error frame'];
  if (error.type) parts.push(`type=${error.type}`);
  if (error.code) parts.push(`code=${error.code}`);
  return parts.join(' ');
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
  private readonly path: string;
  private readonly maxOutputTokens?: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.providerId = options.providerId;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.extraHeaders = options.extraHeaders ?? {};
    this.supportsNativeTools = options.supportsNativeTools ?? true;
    this.path = options.path ?? '/chat/completions';
    this.maxOutputTokens = options.maxOutputTokens;
  }

  /**
   * Clamps at the adapter rather than defaulting, because the caller's value is
   * rarely absent: agent frontmatter always populates `maxTokens`, so a provider
   * ceiling expressed as a default would never take effect.
   */
  private resolveMaxTokens(requested?: number): number {
    const wanted = requested ?? DEFAULT_MAX_TOKENS;
    return this.maxOutputTokens ? Math.min(wanted, this.maxOutputTokens) : wanted;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return withCallMetrics(this.providerId, request.model ?? this.defaultModel, async () => {
    try {
      const body: Record<string, unknown> = {
        model: request.model ?? this.defaultModel,
        messages: toOpenAIMessages(request),
        max_tokens: this.resolveMaxTokens(request.maxTokens),
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

      const response = await this.post(this.path, body, request.signal);

      // Read as text before parsing: an error response is often not JSON (a proxy
      // HTML page, a plain-text gateway message), and parsing it first loses the
      // status that decides retryability.
      if (!response.ok) {
        throw httpProviderError(this.providerId, response.status, await response.text());
      }

      const responseBody = (await response.json()) as OpenAIChatCompletionResponse;
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
      throw toProviderError(this.providerId, error);
    }
    });
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const startedAtMs = Date.now();
    const modelId = request.model ?? this.defaultModel;
    try {
      const body: Record<string, unknown> = {
        model: request.model ?? this.defaultModel,
        messages: toOpenAIMessages(request),
        max_tokens: this.resolveMaxTokens(request.maxTokens),
        temperature: request.temperature,
        stream: true,
        // Without this the final frame carries no usage, so streamed calls report
        // zero tokens and never reach the spend ledger.
        stream_options: { include_usage: true },
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

      const response = await this.post(this.path, body, request.signal);

      if (!response.ok) {
        const errorBody = await response.text();
        yield httpErrorChunk(this.providerId, response.status, errorBody);
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
      let finishReason: string | undefined;
      // A stream is only complete once the host sends `[DONE]` or a finish_reason.
      // Ending without either means the connection dropped mid-generation.
      let sawTerminator = false;

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
          if (!data) continue;
          if (data === '[DONE]') {
            sawTerminator = true;
            continue;
          }

          const parsed = JSON.parse(data) as OpenAIStreamFrame;

          if (parsed.error) {
            // No status on a frame error, so it is not classified as retryable:
            // a context-length or bad-request frame would only fail the next target too.
            yield { type: 'error', error: formatStreamFrameError(parsed.error), retryable: false };
            return;
          }

          const frameFinish = parsed.choices?.[0]?.finish_reason;
          if (frameFinish) {
            finishReason = frameFinish;
            sawTerminator = true;
          }

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

      if (!sawTerminator) {
        yield {
          type: 'error',
          error: 'Stream ended before the provider signalled completion (no finish_reason, no [DONE])',
          // A dropped connection is worth another target.
          retryable: true,
        };
        return;
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

      recordStreamMetrics(this.providerId, modelId, streamUsage, startedAtMs);
      yield {
        type: 'done',
        usage: streamUsage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason,
      };
    } catch (error) {
      yield toErrorChunk(this.providerId, error);
    }
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
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
      signal,
    });
  }
}

export { toOpenAIMessages, type OpenAIChatMessage };
