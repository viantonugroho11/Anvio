import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamChunk } from '@anvio/core';
import { OpenAICompatibleProvider } from './openai-compatible.provider.js';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

/** Builds a streaming Response whose body emits `frames` as raw SSE text, one write per entry. */
function sseResponse(frames: string[], ok = true): Response {
  const encoder = new TextEncoder();
  return {
    ok,
    status: ok ? 200 : 400,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    text: async () => frames.join(''),
  } as unknown as Response;
}

function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function newProvider() {
  return new OpenAICompatibleProvider({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    defaultModel: 'gpt-4o',
  });
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function requestBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const ASK: Parameters<OpenAICompatibleProvider['stream']>[0] = {
  messages: [{ role: 'user', content: 'hi' }],
};

describe('OpenAICompatibleProvider.stream', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requests usage on the final frame', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        dataFrame({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]),
    );

    await collect(newProvider().stream(ASK));

    expect(requestBody().stream_options).toEqual({ include_usage: true });
  });

  it('surfaces a mid-stream error frame and stops', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        dataFrame({ choices: [{ delta: { content: 'partial' } }] }),
        dataFrame({ error: { message: 'context length exceeded', type: 'invalid_request_error' } }),
        'data: [DONE]\n\n',
      ]),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
    expect((chunks.at(-1) as { error: string }).error).toContain('context length exceeded');
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
  });

  it('errors when the stream ends without a terminator', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([dataFrame({ choices: [{ delta: { content: 'cut off mid-' } }] })]),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'cut off mid-' });
    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
  });

  it('reports the truncation finish_reason on the done chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        dataFrame({ choices: [{ delta: { content: 'a long answer' } }] }),
        dataFrame({
          choices: [{ delta: {}, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: 8192, total_tokens: 8202 },
        }),
        'data: [DONE]\n\n',
      ]),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks.at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 8192, totalTokens: 8202 },
      toolCalls: undefined,
      finishReason: 'length',
    });
  });

  it('treats a finish_reason as a terminator even without [DONE]', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([dataFrame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('reassembles a frame split across read boundaries', async () => {
    const frame = dataFrame({ choices: [{ delta: { content: 'split' }, finish_reason: 'stop' }] });
    const cut = Math.floor(frame.length / 2);
    fetchMock.mockResolvedValueOnce(
      sseResponse([frame.slice(0, cut), frame.slice(cut), 'data: [DONE]\n\n']),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'split' });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('accumulates tool-call arguments fragmented across frames', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        dataFrame({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } },
                ],
              },
            },
          ],
        }),
        dataFrame({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '"anvio"}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        'data: [DONE]\n\n',
      ]),
    );

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks).toContainEqual({
      type: 'tool_use',
      toolCall: { id: 'call_1', name: 'search', arguments: { q: 'anvio' } },
    });
  });

  it('yields an error chunk on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['{"error":{"message":"bad key"}}'], false));

    const chunks = await collect(newProvider().stream(ASK));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error' });
  });
});
