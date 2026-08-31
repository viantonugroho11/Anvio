// Per-thread runtime/provider/model overrides — ADR-0024.
//
// The operator picks a provider/model/runtime for one conversation without
// editing the agent's YAML file. The overrides live on the session's
// metadata block so an override in thread A stays invisible to thread B.
// Applied by cloning the agent definition with the overridden fields
// before it reaches the runtime and model routers — no schema change to
// the agent itself.

import type { AgentDefinition, ModelProviderId, Session } from '@anvio/core';

/**
 * Runtime ids that a per-thread override may set — the subset that the
 * agent runtime binding accepts. Broader `RuntimeProviderId` includes
 * transports (ssh/docker/…) that aren't valid on `spec.runtime.provider`.
 */
export type AgentRuntimeOverride = 'local' | 'cursor' | 'claude-code' | 'codex' | 'antigravity';

/**
 * Session-level overrides that live under `metadata`. Documented as a
 * type so slash-command handlers and the runtime layer agree on the
 * field names — they were `Record<string, unknown>` on the wire since
 * v1, but nothing consulted them consistently.
 */
export interface SessionOverrides {
  providerOverride?: ModelProviderId;
  modelOverride?: string;
  runtimeOverride?: AgentRuntimeOverride;
  checkpointLabel?: string;
}

export function readSessionOverrides(session: Session | undefined): SessionOverrides {
  const meta = session?.state && 'metadata' in session.state
    ? ((session.state as { metadata?: Record<string, unknown> }).metadata ?? {})
    : {};
  const source = (session as unknown as { metadata?: Record<string, unknown> })?.metadata ?? meta;
  return {
    providerOverride: typeof source.providerOverride === 'string'
      ? (source.providerOverride as ModelProviderId)
      : undefined,
    modelOverride: typeof source.modelOverride === 'string' ? source.modelOverride : undefined,
    runtimeOverride: typeof source.runtimeOverride === 'string'
      ? (source.runtimeOverride as AgentRuntimeOverride)
      : undefined,
    checkpointLabel: typeof source.checkpointLabel === 'string' ? source.checkpointLabel : undefined,
  };
}

/**
 * Return a shallow-cloned AgentDefinition with the session's provider /
 * model / runtime overrides folded into the agent's spec. Original is
 * untouched — the mutation lives in the returned copy only.
 */
export function applySessionOverrides(
  agent: AgentDefinition,
  session: Session | undefined,
): AgentDefinition {
  const overrides = readSessionOverrides(session);
  const anyOverride =
    overrides.providerOverride || overrides.modelOverride || overrides.runtimeOverride;
  if (!anyOverride) return agent;
  const spec = { ...agent.spec };
  if (overrides.providerOverride || overrides.modelOverride) {
    spec.model = {
      ...agent.spec.model,
      ...(overrides.providerOverride ? { provider: overrides.providerOverride } : {}),
      ...(overrides.modelOverride ? { model: overrides.modelOverride } : {}),
    };
  }
  if (overrides.runtimeOverride) {
    spec.runtime = {
      ...(agent.spec.runtime ?? {}),
      provider: overrides.runtimeOverride,
    };
  }
  return { ...agent, spec };
}
