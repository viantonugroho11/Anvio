import { describe, expect, it } from 'vitest';
import {
  decideToolCall,
  mergeToolPolicies,
  toolPolicySchema,
  type LayeredPolicy,
} from './policy.js';

function p(overrides: Partial<import('./policy.js').ToolPolicy> = {}) {
  return toolPolicySchema.parse({
    denied: [],
    requireApproval: [],
    argumentOverrides: {},
    ...overrides,
  });
}

describe('ToolPolicy — layered merge precedence', () => {
  it('agent narrows allow-list against project', () => {
    const merged = mergeToolPolicies([
      { layer: 'project', policy: p({ allowed: ['fs_*', 'web_fetch'] }) },
      { layer: 'agent', policy: p({ allowed: ['fs_read', 'web_fetch'] }) },
    ]);
    expect(merged.allowed).toEqual(['fs_read', 'web_fetch']);
  });

  it('agent cannot broaden allow-list beyond project', () => {
    const merged = mergeToolPolicies([
      { layer: 'project', policy: p({ allowed: ['fs_read'] }) },
      { layer: 'agent', policy: p({ allowed: ['fs_write', 'exec'] }) },
    ]);
    // No agent value matches any project pattern → empty intersection
    expect(merged.allowed).toEqual([]);
  });

  it('denies union across all layers', () => {
    const merged = mergeToolPolicies([
      { layer: 'default', policy: p({ denied: ['exec'] }) },
      { layer: 'tenant', policy: p({ denied: ['fs_delete'] }) },
      { layer: 'agent', policy: p({ denied: ['web_search'] }) },
    ]);
    expect(new Set(merged.denied)).toEqual(new Set(['exec', 'fs_delete', 'web_search']));
  });

  it('requireApproval unions and never softens', () => {
    const merged = mergeToolPolicies([
      { layer: 'default', policy: p({ requireApproval: ['exec'] }) },
      { layer: 'agent', policy: p({ requireApproval: ['fs_write'] }) },
    ]);
    expect(new Set(merged.requireApproval)).toEqual(new Set(['exec', 'fs_write']));
  });

  it('last non-empty layer wins for note + argumentOverrides', () => {
    const merged = mergeToolPolicies([
      { layer: 'default', policy: p({ note: 'baseline' }) },
      { layer: 'project', policy: p({ note: 'project override' }) },
      { layer: 'agent', policy: p({ argumentOverrides: { web_fetch: { maxBytes: 1024 } } }) },
    ]);
    expect(merged.note).toBe('project override');
    expect(merged.argumentOverrides).toEqual({ web_fetch: { maxBytes: 1024 } });
  });
});

describe('decideToolCall', () => {
  it('blocks denied tools even when in allow-list', () => {
    const policy = p({ allowed: ['fs_*'], denied: ['fs_delete'] });
    expect(decideToolCall(policy, 'fs_delete')).toEqual({ allowed: false, reason: 'blocked' });
    expect(decideToolCall(policy, 'fs_read')).toEqual({ allowed: true, requiresApproval: false });
  });

  it('denies tools not in allow-list when one is set', () => {
    const policy = p({ allowed: ['web_*'] });
    expect(decideToolCall(policy, 'exec')).toEqual({ allowed: false, reason: 'notInAllowList' });
  });

  it('allows all when no allow-list is set (deny-only mode)', () => {
    const policy = p({ denied: ['exec'] });
    expect(decideToolCall(policy, 'fs_read')).toEqual({ allowed: true, requiresApproval: false });
    expect(decideToolCall(policy, 'exec')).toEqual({ allowed: false, reason: 'blocked' });
  });

  it('signals approval requirement without blocking', () => {
    const policy = p({ requireApproval: ['exec'] });
    expect(decideToolCall(policy, 'exec')).toEqual({ allowed: true, requiresApproval: true });
  });

  it('glob patterns match via *', () => {
    const policy = p({ allowed: ['fs_read_*'], denied: ['fs_read_secret'] });
    expect(decideToolCall(policy, 'fs_read_config')).toEqual({ allowed: true, requiresApproval: false });
    expect(decideToolCall(policy, 'fs_read_secret')).toEqual({ allowed: false, reason: 'blocked' });
    expect(decideToolCall(policy, 'fs_write')).toEqual({ allowed: false, reason: 'notInAllowList' });
  });
});

describe('layer ordering is deterministic regardless of input order', () => {
  it('sorts by POLICY_LAYER_ORDER before merge', () => {
    const inOrder: LayeredPolicy[] = [
      { layer: 'default', policy: p({ note: 'a' }) },
      { layer: 'agent', policy: p({ note: 'z' }) },
    ];
    const outOfOrder: LayeredPolicy[] = [
      { layer: 'agent', policy: p({ note: 'z' }) },
      { layer: 'default', policy: p({ note: 'a' }) },
    ];
    expect(mergeToolPolicies(inOrder)).toEqual(mergeToolPolicies(outOfOrder));
  });
});
