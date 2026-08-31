import { describe, it, expect } from 'vitest';
import type { AgentDefinition, Session } from '@anvio/core';
import { applySessionOverrides, readSessionOverrides } from './session-overrides.js';

function makeAgent(): AgentDefinition {
  return {
    apiVersion: 'anvio.io/v1',
    kind: 'Agent',
    metadata: { name: 'architect', version: '1.0.0' },
    spec: {
      description: 'Architect',
      persona: 'default',
      skills: [],
      tools: [],
      model: { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8192 },
    },
  } as AgentDefinition;
}

function makeSession(metadata: Record<string, unknown>): Session {
  return {
    id: 's1',
    userId: 'u1',
    agentId: 'architect',
    channel: 'telegram',
    state: { status: 'idle', messages: [] },
    lastActiveAt: new Date(),
    metadata,
  } as unknown as Session;
}

describe('applySessionOverrides', () => {
  it('returns the original agent when no overrides are present', () => {
    const agent = makeAgent();
    const session = makeSession({});
    expect(applySessionOverrides(agent, session)).toBe(agent);
  });

  it('overrides the model provider only', () => {
    const agent = makeAgent();
    const session = makeSession({ providerOverride: 'deepseek' });
    const out = applySessionOverrides(agent, session);
    expect(out.spec.model.provider).toBe('deepseek');
    expect(out.spec.model.model).toBe('claude-sonnet-5');
    expect(agent.spec.model.provider).toBe('anthropic');
  });

  it('overrides the model id only', () => {
    const agent = makeAgent();
    const session = makeSession({ modelOverride: 'claude-3-5-haiku-latest' });
    const out = applySessionOverrides(agent, session);
    expect(out.spec.model.model).toBe('claude-3-5-haiku-latest');
    expect(out.spec.model.provider).toBe('anthropic');
  });

  it('overrides the runtime provider', () => {
    const agent = makeAgent();
    const session = makeSession({ runtimeOverride: 'claude-code' });
    const out = applySessionOverrides(agent, session);
    expect(out.spec.runtime?.provider).toBe('claude-code');
    expect(agent.spec.runtime).toBeUndefined();
  });

  it('readSessionOverrides ignores non-string values', () => {
    const session = makeSession({
      providerOverride: 42,
      modelOverride: null,
      runtimeOverride: 'local',
    });
    const out = readSessionOverrides(session);
    expect(out.providerOverride).toBeUndefined();
    expect(out.modelOverride).toBeUndefined();
    expect(out.runtimeOverride).toBe('local');
  });
});
