import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, KNOWN_MODEL_IDS, RETIRED_ANTHROPIC_MODEL_IDS } from '@anvio/core';
import {
  listModelDescriptors,
  getModelDescriptor,
  costInputFromUsage,
} from './model-descriptor.js';
import { createModelProvider } from './provider-factory.js';

describe('model id registry', () => {
  it('keys every descriptor on a shared constant', () => {
    for (const descriptor of listModelDescriptors()) {
      expect(KNOWN_MODEL_IDS.has(descriptor.model)).toBe(true);
    }
  });

  it('references no retired Anthropic model', () => {
    const anthropic = listModelDescriptors().filter((d) => d.provider === 'anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    for (const descriptor of anthropic) {
      expect(RETIRED_ANTHROPIC_MODEL_IDS.has(descriptor.model)).toBe(false);
    }
  });

  it('resolves a descriptor for every default model', () => {
    expect(getModelDescriptor('anthropic', DEFAULT_MODELS.anthropic)).toBeDefined();
    expect(getModelDescriptor('gemini', DEFAULT_MODELS.gemini)).toBeDefined();
  });

  it('applies the shared default when no model is requested', () => {
    // Guards against a provider drifting back to its own literal.
    const anthropic = createModelProvider({ provider: 'anthropic', apiKey: 'k' }) as unknown as {
      defaultModel: string;
    };
    const gemini = createModelProvider({ provider: 'gemini', apiKey: 'k' }) as unknown as {
      defaultModel: string;
    };

    expect(anthropic.defaultModel).toBe(DEFAULT_MODELS.anthropic);
    expect(gemini.defaultModel).toBe(DEFAULT_MODELS.gemini);
  });
});

describe('costInputFromUsage', () => {
  it('subtracts cache tokens from the inclusive input total', () => {
    expect(
      costInputFromUsage({
        inputTokens: 1_000,
        outputTokens: 50,
        totalTokens: 1_050,
        cacheReadInputTokens: 700,
        cacheCreationInputTokens: 200,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 700,
      cacheCreationTokens: 200,
    });
  });

  it('passes usage without cache fields straight through', () => {
    expect(costInputFromUsage({ inputTokens: 300, outputTokens: 20, totalTokens: 320 })).toEqual({
      inputTokens: 300,
      outputTokens: 20,
    });
  });

  it('never returns a negative input count', () => {
    // Defensive: a provider reporting cache counts that exceed its own input
    // total would otherwise produce a negative charge.
    expect(
      costInputFromUsage({
        inputTokens: 100,
        outputTokens: 0,
        totalTokens: 100,
        cacheReadInputTokens: 500,
      }).inputTokens,
    ).toBe(0);
  });
});
