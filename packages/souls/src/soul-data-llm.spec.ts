import { describe, expect, it, vi } from 'vitest';
import type { ChatResponse, ModelProvider } from '@anvio/core';
import { extractSoulData } from './soul-data-llm.js';

const SAMPLE_MD = `# Aiko

## Identity
- Name: Aiko
- Role: Home ops assistant
- Description: Keeps household schedule and reminders.

## Values
- reliability
- warmth

## Personality
- calm
- thoughtful

## Preferences
- language: id
- reminder_style: gentle

## Communication
- Tone: warm
- Format: short paragraphs

## Long-term goals
- reduce cognitive load for the family

## Behavioral tendencies
- confirm before deleting recurring events
`;

function mockProvider(content: string, providerId = 'anthropic'): ModelProvider {
  return {
    providerId,
    chat: vi.fn(
      async (): Promise<ChatResponse> => ({
        content,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'test',
        finishReason: 'end_turn',
      }),
    ),
    async *stream() {},
  } as unknown as ModelProvider;
}

describe('extractSoulData', () => {
  it('returns regex baseline when no model provider is supplied', async () => {
    const soul = await extractSoulData(SAMPLE_MD, 'aiko');
    expect(soul.spec.name).toBe('Aiko');
    expect(soul.spec.values).toContain('reliability');
    expect(soul.spec.behavioralTendencies).toContain(
      'confirm before deleting recurring events',
    );
  });

  it('returns regex baseline when providerId is "mock"', async () => {
    const soul = await extractSoulData(
      SAMPLE_MD,
      'aiko',
      mockProvider('{"name":"OTHER"}', 'mock'),
    );
    expect(soul.spec.name).toBe('Aiko');
  });

  it('merges LLM arrays over regex baseline when non-empty', async () => {
    const llm = JSON.stringify({
      values: ['reliability', 'warmth', 'patience'],
      behavioralTendencies: [
        'confirm before deleting recurring events',
        'batch reminders in the morning',
      ],
    });
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', mockProvider(llm));
    expect(soul.spec.values).toEqual(['reliability', 'warmth', 'patience']);
    expect(soul.spec.behavioralTendencies).toContain('batch reminders in the morning');
  });

  it('keeps regex baseline when LLM returns empty arrays', async () => {
    const llm = JSON.stringify({ values: [], personality: [] });
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', mockProvider(llm));
    expect(soul.spec.values).toContain('reliability');
    expect(soul.spec.personality).toContain('calm');
  });

  it('merges preferences additively', async () => {
    const llm = JSON.stringify({ preferences: { timezone: 'Asia/Jakarta' } });
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', mockProvider(llm));
    expect(soul.spec.preferences.language).toBe('id');
    expect(soul.spec.preferences.timezone).toBe('Asia/Jakarta');
  });

  it('overrides identity role when LLM supplies a non-empty value', async () => {
    const llm = JSON.stringify({ identity: { role: 'Household concierge' } });
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', mockProvider(llm));
    expect(soul.spec.identity.role).toBe('Household concierge');
    expect(soul.spec.identity.description).toContain('household schedule');
  });

  it('falls back to baseline when LLM output is unparseable JSON', async () => {
    const soul = await extractSoulData(
      SAMPLE_MD,
      'aiko',
      mockProvider('not-json-at-all'),
    );
    expect(soul.spec.name).toBe('Aiko');
    expect(soul.spec.values).toContain('reliability');
  });

  it('falls back to baseline when LLM call throws', async () => {
    const provider = {
      providerId: 'anthropic',
      chat: vi.fn().mockRejectedValue(new Error('rate limited')),
      async *stream() {},
    } as unknown as ModelProvider;
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', provider);
    expect(soul.spec.name).toBe('Aiko');
  });

  it('extracts JSON from fenced code block', async () => {
    const llm = '```json\n{"name":"Aiko","values":["kindness"]}\n```';
    const soul = await extractSoulData(SAMPLE_MD, 'aiko', mockProvider(llm));
    expect(soul.spec.values).toEqual(['kindness']);
  });

  it('sets slug on the imported definition', async () => {
    const soul = await extractSoulData(SAMPLE_MD, 'aiko-2');
    expect(soul.metadata.slug).toBe('aiko-2');
  });
});
