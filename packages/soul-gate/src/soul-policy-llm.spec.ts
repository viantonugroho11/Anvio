import { describe, expect, it } from 'vitest';
import type { ModelProvider, SoulPolicy } from '@anvio/core';
import { extractSoulPolicy } from './soul-policy-llm.js';

const SOUL = `## Identity
- Name: Test Soul
- Role: Operator

## Reporting
- Manager: slack:U_MANAGER

## Approvers
- slack:U_MANAGER: anything ; catchall

## Mandate
- Ship safely.
`;

describe('extractSoulPolicy', () => {
  it('falls back to regex when model is mock', async () => {
    const mock: ModelProvider = {
      providerId: 'mock',
      async chat() {
        return {
          content: '{}',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          model: 'mock',
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
    };

    const policy = await extractSoulPolicy(SOUL, 'test-soul', mock);
    expect(policy.identity.name).toBe('Test Soul');
    expect(policy.manager?.userId).toBe('slack:U_MANAGER');
  });

  it('merges LLM JSON when provider returns structured policy', async () => {
    const llmPolicy: Partial<SoulPolicy> = {
      mandate: 'Ship safely with approvals.',
      values: ['safety'],
    };

    const provider: ModelProvider = {
      providerId: 'anthropic',
      async chat() {
        return {
          content: JSON.stringify(llmPolicy),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: 'claude-test',
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
    };

    const policy = await extractSoulPolicy(SOUL, 'test-soul', provider);
    expect(policy.mandate).toContain('Ship safely');
    expect(policy.values).toContain('safety');
    expect(policy.manager?.userId).toBe('slack:U_MANAGER');
  });
});
