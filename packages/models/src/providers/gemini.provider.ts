import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ModelToolCall,
  StreamChunk,
} from '@anvio/core';
import {
  extractGeminiText,
  extractGeminiToolCalls,
  toGeminiContents,
  type GeminiPart,
} from './gemini-messages.js';

export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

export class GeminiProvider implements ModelProvider {
  readonly providerId = 'gemini';
  readonly supportsNativeTools = true;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel ?? 'gemini-2.0-flash';
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const model = request.model ?? this.defaultModel;
      const response = await this.generate(model, request, false);
      const body = (await response.json()) as GeminiGenerateResponse;

      if (!response.ok) {
        throw new Error(JSON.stringify(body));
      }

      const parts = body.candidates?.[0]?.content?.parts;
      const toolCalls = extractGeminiToolCalls(parts);
      const content = extractGeminiText(parts);
      const usage = body.usageMetadata;

      return {
        content,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
          totalTokens: usage?.totalTokenCount ?? 0,
        },
        model: body.modelVersion ?? model,
        finishReason: body.candidates?.[0]?.finishReason ?? 'STOP',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      throw new AnvioError('MODEL_PROVIDER_ERROR', 'Gemini API call failed', {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    try {
      const model = request.model ?? this.defaultModel;
      const response = await this.generate(model, request, true);

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
      const seenToolIds = new Set<string>();
      const toolCalls: ModelToolCall[] = [];
      let streamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const trimmed = chunk.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          const parsed = JSON.parse(data) as GeminiGenerateResponse;
          const parts = parsed.candidates?.[0]?.content?.parts;
          const meta = parsed.usageMetadata;
          if (meta) {
            streamUsage = {
              inputTokens: meta.promptTokenCount ?? streamUsage.inputTokens,
              outputTokens: meta.candidatesTokenCount ?? streamUsage.outputTokens,
              totalTokens: meta.totalTokenCount ?? streamUsage.totalTokens,
            };
          }
          const text = extractGeminiText(parts);
          if (text) {
            yield { type: 'text_delta', delta: text };
          }

          for (const call of extractGeminiToolCalls(parts)) {
            if (seenToolIds.has(call.id)) continue;
            seenToolIds.add(call.id);
            toolCalls.push(call);
            yield { type: 'tool_use', toolCall: call };
          }
        }
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

  private buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      systemInstruction: request.systemPrompt
        ? { parts: [{ text: request.systemPrompt }] }
        : undefined,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 8192,
        temperature: request.temperature,
      },
    };

    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
        },
      ];
    }

    return body;
  }

  private async generate(model: string, request: ChatRequest, stream: boolean): Promise<Response> {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${this.baseUrl}/models/${model}:${action}?key=${encodeURIComponent(this.apiKey)}${stream ? '&alt=sse' : ''}`;

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildBody(request)),
    });
  }
}

export { toGeminiContents, extractGeminiToolCalls, extractGeminiText };
