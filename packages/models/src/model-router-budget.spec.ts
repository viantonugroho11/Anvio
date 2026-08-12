import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResponse, ModelProvider, TokenUsage, StreamChunk } from '@anvio/core';
import { SpendBudgetLedger } from './spend-budget.js';
import { ModelRouter } from './model-router.js';

function stubProvider(providerId: string, usage: TokenUsage): ModelProvider {
  return {
    providerId,
    supportsNativeTools: true,
    async chat(): Promise<ChatResponse> {
      return {
        content: 'ok',
        usage,
        model: 'claude-sonnet-4-20250514',
        finishReason: 'end_turn',
      };
    },
    async *stream(): AsyncIterable<StreamChunk> {
      yield { type: 'done', usage };
    },
  };
}

const stubStorage = {
  read: async () => null,
} as unknown as import('@anvio/storage').FilesystemStorageProvider;

const bigUsage: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  totalTokens: 2_000_000,
};

describe('ModelRouter — SpendBudget integration', () => {
  it('charges the ledger after a successful call with a budgetKey', async () => {
    const ledger = new SpendBudgetLedger();
    const router = new ModelRouter({
      storage: stubStorage,
      providers: new Map([['anthropic', stubProvider('anthropic', bigUsage)]]),
      spendBudget: ledger,
    });
    await router.chat({
      messages: [{ role: 'user', content: 'hi' }],
      budgetKey: 'tenant:acme',
    } as ChatRequest & { budgetKey: string });
    // Sonnet: 1M input @ 3 + 1M output @ 15 = 18
    expect(ledger.spentFor('tenant:acme')).toBeCloseTo(18);
  });

  it('does not charge when budgetKey is missing', async () => {
    const ledger = new SpendBudgetLedger();
    const router = new ModelRouter({
      storage: stubStorage,
      providers: new Map([['anthropic', stubProvider('anthropic', bigUsage)]]),
      spendBudget: ledger,
    });
    await router.chat({
      messages: [{ role: 'user', content: 'hi' }],
    } as ChatRequest);
    expect(ledger.spentFor('tenant:acme')).toBe(0);
  });

  it('does not charge when no ledger is wired', async () => {
    const router = new ModelRouter({
      storage: stubStorage,
      providers: new Map([['anthropic', stubProvider('anthropic', bigUsage)]]),
    });
    // Should not throw despite no ledger.
    const result = await router.chat({
      messages: [{ role: 'user', content: 'hi' }],
      budgetKey: 'tenant:acme',
    } as ChatRequest & { budgetKey: string });
    expect(result.selectedProvider).toBe('anthropic');
  });

  it('throws MODEL_SPEND_BUDGET_EXCEEDED on the call that would breach the cap', async () => {
    const ledger = new SpendBudgetLedger();
    ledger.setCap('run:xyz', 10); // 10 USD cap
    const router = new ModelRouter({
      storage: stubStorage,
      providers: new Map([['anthropic', stubProvider('anthropic', bigUsage)]]),
      spendBudget: ledger,
    });
    // First call = 18 USD > 10 cap → throws on charge() AFTER the provider returned.
    await expect(
      router.chat({
        messages: [{ role: 'user', content: 'hi' }],
        budgetKey: 'run:xyz',
      } as ChatRequest & { budgetKey: string }),
    ).rejects.toThrow(/Spend cap exceeded/);
    expect(ledger.spentFor('run:xyz')).toBe(0);
  });

  it('silently skips charge for unknown-cost models', async () => {
    const ledger = new SpendBudgetLedger();
    const unknownModelProvider: ModelProvider = {
      providerId: 'anthropic',
      async chat() {
        return {
          content: 'ok',
          usage: bigUsage,
          model: 'unknown-model-name',
          finishReason: 'end_turn',
        };
      },
      async *stream() {
        yield { type: 'done', usage: bigUsage };
      },
    };
    const router = new ModelRouter({
      storage: stubStorage,
      providers: new Map([['anthropic', unknownModelProvider]]),
      spendBudget: ledger,
    });
    await router.chat({
      messages: [{ role: 'user', content: 'hi' }],
      budgetKey: 'k',
    } as ChatRequest & { budgetKey: string });
    expect(ledger.spentFor('k')).toBe(0);
  });
});

// silence unused import lint
void vi;
