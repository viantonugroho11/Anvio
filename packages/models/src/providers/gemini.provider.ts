import { AnvioError } from '@anvio/core';
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamChunk,
} from '@anvio/core';

export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

export class GeminiProvider implements ModelProvider {
  readonly providerId = 'gemini';
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

      const content = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
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
          const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
          if (text) {
            yield { type: 'text_delta', delta: text };
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

  private toContents(request: ChatRequest): GeminiContent[] {
    return request.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
  }

  private async generate(model: string, request: ChatRequest, stream: boolean): Promise<Response> {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${this.baseUrl}/models/${model}:${action}?key=${encodeURIComponent(this.apiKey)}${stream ? '&alt=sse' : ''}`;

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: this.toContents(request),
        systemInstruction: request.systemPrompt
          ? { parts: [{ text: request.systemPrompt }] }
          : undefined,
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? 8192,
          temperature: request.temperature,
        },
      }),
    });
  }
}
