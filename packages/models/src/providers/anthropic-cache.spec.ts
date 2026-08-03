import { describe, expect, it, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { create: createMock, stream: streamMock };
    },
  };
});

import { AnthropicProvider } from './anthropic.provider.js';

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: 'hello' }],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    ...overrides,
  };
}

describe('AnthropicProvider prompt caching', () => {
  beforeEach(() => {
    createMock.mockReset();
    streamMock.mockReset();
    createMock.mockResolvedValue(makeResponse());
  });

  it('tags system prompt with cache_control when promptCaching enabled (default)', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    await provider.chat({
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const call = createMock.mock.calls[0][0];
    expect(call.system).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('passes system as plain string when promptCaching disabled', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', promptCaching: false });
    await provider.chat({
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(createMock.mock.calls[0][0].system).toBe('You are helpful.');
  });

  it('tags only the last tool with cache_control when caching enabled', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } },
        { name: 'c', description: 'C', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    const tools = createMock.mock.calls[0][0].tools;
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[1].cache_control).toBeUndefined();
    expect(tools[2].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not tag any tool when caching disabled', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', promptCaching: false });
    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } }],
    });
    expect(createMock.mock.calls[0][0].tools[0].cache_control).toBeUndefined();
  });

  it('surfaces cache read/write tokens in usage', async () => {
    createMock.mockResolvedValueOnce(
      makeResponse({
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 8000,
        },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    const res = await provider.chat({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.usage.cacheCreationInputTokens).toBe(2000);
    expect(res.usage.cacheReadInputTokens).toBe(8000);
    expect(res.usage.inputTokens).toBe(10 + 2000 + 8000);
    expect(res.usage.totalTokens).toBe(10 + 2000 + 8000 + 5);
  });

  it('omits cache fields when both counts are zero', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    const res = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.usage.cacheCreationInputTokens).toBeUndefined();
    expect(res.usage.cacheReadInputTokens).toBeUndefined();
  });

  it('omits system field when no system prompt is set', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(createMock.mock.calls[0][0].system).toBeUndefined();
  });
});
