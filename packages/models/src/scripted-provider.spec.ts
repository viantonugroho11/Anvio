import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@anvio/core';
import { ScriptedModelProvider } from './scripted-provider.js';

describe('ScriptedModelProvider', () => {
  it('replays turns in order, then marks exhaustion', async () => {
    const model = new ScriptedModelProvider([{ text: 'one' }, { text: 'two' }]);
    expect((await model.chat({ messages: [] })).content).toBe('one');
    expect((await model.chat({ messages: [] })).content).toBe('two');
    expect((await model.chat({ messages: [] })).content).toContain('exhausted');
    expect(model.requests).toHaveLength(3);
  });

  it('streams tool calls with stable ids', async () => {
    const model = new ScriptedModelProvider([{ toolCalls: [{ name: 'anvio_channel__reply', arguments: { text: 'hi' } }] }]);
    const chunks: StreamChunk[] = [];
    for await (const chunk of model.stream({ messages: [] })) chunks.push(chunk);
    expect(chunks[0]).toEqual({
      type: 'tool_use',
      toolCall: { id: 'scripted-1', name: 'anvio_channel__reply', arguments: { text: 'hi' } },
    });
    expect(chunks.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_use' });
  });
});
