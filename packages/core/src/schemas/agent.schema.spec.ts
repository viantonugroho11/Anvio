import { describe, it, expect } from 'vitest';
import { parseAgentDefinition } from './agent.schema.js';

describe('agent.schema', () => {
  it('parses valid agent definition', () => {
    const agent = parseAgentDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Agent',
      metadata: { name: 'architect', version: '1.0.0' },
      spec: {
        description: 'Senior Software Architect',
        persona: 'architect',
        skills: ['architecture'],
        tools: [],
        model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
        memory: { shortTerm: { enabled: true, ttlSeconds: 3600 }, longTerm: { enabled: true }, semantic: { enabled: false } },
        orchestration: { pattern: 'single', delegates: [] },
        approvals: { requiredFor: ['destructive'] },
      },
    });

    expect(agent.metadata.name).toBe('architect');
    expect(agent.spec.model.provider).toBe('anthropic');
  });
});
