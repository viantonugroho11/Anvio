import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinition, StoredSession } from '@anvio/core';
import { createRunCompletedHandler, type RunCompletedHandlerDeps } from './run-completed.js';

function deps(overrides: Partial<RunCompletedHandlerDeps> = {}) {
  const stored = {
    id: 's1',
    agentName: 'architect',
    userId: 'u1',
    channel: 'slack',
    messages: [],
  } as unknown as StoredSession;
  const record = vi.fn(async () => {});
  const sendMessage = vi.fn(async () => {});
  const onSessionCompleted = vi.fn(async () => ({ memoryNudge: { factsStored: 0, facts: [] } }));
  const base: RunCompletedHandlerDeps = {
    sessions: { get: async () => stored },
    loadAgent: async () =>
      ({ spec: { model: { provider: 'openai', model: 'gpt-x' } } }) as unknown as AgentDefinition,
    tokenUsageAudit: { record },
    resolveLearningSoul: async () => undefined,
    learningEngine: { onSessionCompleted } as never,
    sendMessage,
    fallbackProviderId: 'anthropic',
    warn: () => {},
    ...overrides,
  };
  return { base, record, sendMessage, onSessionCompleted };
}

const usage = { inputTokens: 3, outputTokens: 4, totalTokens: 7 };

describe('createRunCompletedHandler', () => {
  it('records the provider that actually served the run', async () => {
    const { base, record } = deps();
    await createRunCompletedHandler(base)({
      data: { sessionId: 's1', usage, provider: 'gemini', model: 'g-1' },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', model: 'g-1' }),
    );
  });

  it("falls back to the agent's configured provider, not the platform default (CQ-019)", async () => {
    const { base, record } = deps();
    await createRunCompletedHandler(base)({ data: { sessionId: 's1', usage } });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-x' }),
    );
  });

  it('uses the platform default only when the agent cannot be loaded', async () => {
    const { base, record } = deps({ loadAgent: async () => Promise.reject(new Error('gone')) });
    await createRunCompletedHandler(base)({ data: { sessionId: 's1', usage } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic' }));
  });

  it('skips accounting for zero-token runs but still runs the learning loop', async () => {
    const { base, record, onSessionCompleted } = deps();
    await createRunCompletedHandler(base)({
      data: { sessionId: 's1', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    });
    expect(record).not.toHaveBeenCalled();
    expect(onSessionCompleted).toHaveBeenCalled();
  });

  it('announces a skill draft in chat channels and survives a delivery failure', async () => {
    const onSessionCompleted = vi.fn(async () => ({
      memoryNudge: { factsStored: 0, facts: [] },
      skillDraft: { slug: 'triage-abc' },
    }));
    const sendMessage = vi.fn(async () => {
      throw new Error('slack down');
    });
    const { base } = deps({ learningEngine: { onSessionCompleted } as never, sendMessage });
    await expect(
      createRunCompletedHandler(base)({ data: { sessionId: 's1' } }),
    ).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith(
      'slack',
      's1',
      expect.objectContaining({ content: expect.stringContaining('/promote triage-abc') }),
    );
  });

  it('ignores events for unknown sessions', async () => {
    const { base, onSessionCompleted } = deps({ sessions: { get: async () => null } });
    await createRunCompletedHandler(base)({ data: { sessionId: 'nope' } });
    expect(onSessionCompleted).not.toHaveBeenCalled();
  });
});
