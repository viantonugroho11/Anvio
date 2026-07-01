import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@anvio/core';
import {
  buildAgentRuntimeChain,
  dedupeRuntimeChain,
  isRuntimeFailoverRetryable,
  isRuntimeFailoverRetryableMessage,
} from './runtime-fallback-chain.js';

function agentWithRuntime(runtime: AgentDefinition['spec']['runtime']): AgentDefinition {
  return {
    apiVersion: 'anvio.io/v1',
    kind: 'Agent',
    metadata: { name: 'architect', version: '1.0.0' },
    spec: {
      description: 'Architect',
      persona: 'default',
      skills: [],
      tools: [],
      model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192 },
      runtime,
    },
  };
}

describe('runtime-fallback-chain', () => {
  it('builds chain from fallbacks array', () => {
    const chain = buildAgentRuntimeChain(
      agentWithRuntime({
        provider: 'claude-code',
        fallbacks: ['cursor', 'codex', 'local'],
      }),
    );
    expect(chain).toEqual(['claude-code', 'cursor', 'codex', 'local']);
  });

  it('uses single fallback shorthand', () => {
    const chain = buildAgentRuntimeChain(
      agentWithRuntime({ provider: 'claude-code', fallback: 'local' }),
    );
    expect(chain).toEqual(['claude-code', 'local']);
  });

  it('defaults to local when no fallback configured', () => {
    const chain = buildAgentRuntimeChain(agentWithRuntime({ provider: 'codex' }));
    expect(chain).toEqual(['codex', 'local']);
  });

  it('dedupes repeated runtime ids', () => {
    expect(dedupeRuntimeChain(['claude-code', 'local', 'local', 'cursor'])).toEqual([
      'claude-code',
      'local',
      'cursor',
    ]);
  });

  it('detects auth failover messages', () => {
    expect(isRuntimeFailoverRetryableMessage('OAuth token expired')).toBe(true);
    expect(isRuntimeFailoverRetryableMessage('401 Unauthorized')).toBe(true);
    expect(isRuntimeFailoverRetryable(new Error('not configured. Run setup-token'))).toBe(true);
    expect(isRuntimeFailoverRetryableMessage('syntax error in yaml')).toBe(false);
  });
});
