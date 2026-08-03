import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini.provider.js';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function mockGeminiResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('GeminiProvider native tool_use', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('advertises native tool support', () => {
    const provider = new GeminiProvider({ apiKey: 'k' });
    expect(provider.supportsNativeTools).toBe(true);
  });

  it('sends tools as functionDeclarations block', async () => {
    fetchMock.mockResolvedValueOnce(
      mockGeminiResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        modelVersion: 'gemini-2.0-flash',
      }),
    );

    const provider = new GeminiProvider({ apiKey: 'k' });
    await provider.chat({
      messages: [{ role: 'user', content: 'search' }],
      tools: [
        {
          name: 'search_code',
          description: 'Search',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'search_code',
            description: 'Search',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
      },
    ]);
  });

  it('extracts functionCall parts as tool calls in chat response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockGeminiResponse({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: 'call_x', name: 'search_code', args: { q: 'anvio' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
      }),
    );

    const provider = new GeminiProvider({ apiKey: 'k' });
    const res = await provider.chat({
      messages: [{ role: 'user', content: 'find' }],
      tools: [
        {
          name: 'search_code',
          description: 'Search',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });

    expect(res.toolCalls).toEqual([
      { id: 'call_x', name: 'search_code', arguments: { q: 'anvio' } },
    ]);
  });

  it('sends prior assistant tool call + tool response as model/functionCall + user/functionResponse', async () => {
    fetchMock.mockResolvedValueOnce(
      mockGeminiResponse({
        candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
        usageMetadata: {},
      }),
    );

    const provider = new GeminiProvider({ apiKey: 'k' });
    await provider.chat({
      messages: [
        { role: 'user', content: 'search' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_code', arguments: { q: 'x' } }],
        },
        {
          role: 'tool',
          toolCallId: 'c1',
          name: 'search_code',
          content: '{"hits":1}',
        },
      ],
      tools: [
        {
          name: 'search_code',
          description: 'Search',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'c1', name: 'search_code', args: { q: 'x' } } }],
    });
    expect(body.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: { id: 'c1', name: 'search_code', response: { hits: 1 } },
        },
      ],
    });
  });
});
