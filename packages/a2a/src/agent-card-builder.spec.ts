import { describe, it, expect } from 'vitest';
import { buildAgentCard } from './server/agent-card-builder.js';
import type { AgentDefinition } from '@anvio/core';

const AGENT: AgentDefinition = {
  apiVersion: 'anvio.io/v1',
  kind: 'Agent',
  metadata: { name: 'researcher', version: '1.0.0' },
  spec: {
    description: 'Research agent',
    persona: 'You are a research assistant.',
    skills: ['web-search', 'summarize'],
    tools: ['web_fetch'],
    model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
    memory: { shortTerm: { enabled: true, ttlSeconds: 3600 }, longTerm: { enabled: true }, semantic: { enabled: false } },
    orchestration: { pattern: 'single', delegates: [] },
    approvals: { requiredFor: ['destructive'] },
    workspace: { isolatedWorktree: false },
  },
};

describe('buildAgentCard', () => {
  it('maps AgentDefinition to A2A AgentCard', () => {
    const card = buildAgentCard(AGENT, {
      baseUrl: 'http://localhost:3001',
      provider: { organization: 'Anvio', url: 'http://localhost:3001' },
    });
    expect(card.name).toBe('researcher');
    expect(card.description).toBe('Research agent');
    expect(card.provider?.organization).toBe('Anvio');
    expect(card.capabilities?.streaming).toBe(true);
    expect(card.supportedInterfaces).toHaveLength(2);
    expect(card.supportedInterfaces![0]!.protocolBinding).toBe('JSONRPC');
    expect(card.supportedInterfaces![1]!.protocolBinding).toBe('HTTP+JSON');
    expect(card.skills).toHaveLength(2);
    expect(card.skills![0]!.name).toBe('web-search');
  });

  it('handles agent with no skills', () => {
    const bare = {
      ...AGENT,
      spec: { ...AGENT.spec, skills: [] },
    };
    const card = buildAgentCard(bare, { baseUrl: 'http://localhost:3001' });
    expect(card.skills).toHaveLength(0);
  });
});
