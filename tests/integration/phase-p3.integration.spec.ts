import { describe, expect, it } from 'vitest';
import { imageGenerate, textToSpeech } from '@anvio/tools';

describe('Phase P3 — media tools', () => {
  it('image_generate returns stub without API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await imageGenerate('a blue robot');
    if (prev) process.env.OPENAI_API_KEY = prev;
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result.output)).toContain('OPENAI_API_KEY');
  });

  it('text_to_speech returns audio stub without API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await textToSpeech('Hello world');
    if (prev) process.env.OPENAI_API_KEY = prev;
    expect(result.status).toBe('completed');
    expect(result.output).toBeDefined();
  });
});
