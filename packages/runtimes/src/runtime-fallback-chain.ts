import { AnvioError } from '@anvio/core';
import type { AgentDefinition, RuntimeProviderId } from '@anvio/core';

/** Agent-scoped runtime IDs (excludes ssh/docker/daytona/modal). */
export const AGENT_RUNTIME_PROVIDER_IDS = [
  'local',
  'cursor',
  'claude-code',
  'codex',
  'antigravity',
] as const;

export type AgentRuntimeProviderId = (typeof AGENT_RUNTIME_PROVIDER_IDS)[number];

export interface RuntimeFallbackAttempt {
  runtimeId: RuntimeProviderId;
  error: string;
}

export interface RuntimeFallbackRunResult {
  failover: boolean;
  attempts: RuntimeFallbackAttempt[];
}

const AUTH_FAILOVER_PATTERN =
  /not configured|oauth|authentication|authenticated|login required|unauthorized|401|403|token expired|expired token|invalid token|invalid_api_key|auth.*fail|setup-token|API key shadows|subscription auth|not authenticated|login failed/i;

export function isRuntimeFailoverRetryableMessage(message: string): boolean {
  return AUTH_FAILOVER_PATTERN.test(message);
}

export function isRuntimeFailoverRetryable(error: unknown): boolean {
  if (error instanceof AnvioError) {
    return isRuntimeFailoverRetryableMessage(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return isRuntimeFailoverRetryableMessage(message);
}

export function dedupeRuntimeChain(chain: RuntimeProviderId[]): RuntimeProviderId[] {
  const seen = new Set<RuntimeProviderId>();
  const out: RuntimeProviderId[] = [];
  for (const id of chain) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Build ordered runtime chain: primary → fallbacks → default `local`. */
export function buildAgentRuntimeChain(
  agent: AgentDefinition,
  defaultRuntime: RuntimeProviderId = 'local',
): RuntimeProviderId[] {
  const binding = agent.spec.runtime;
  const primary = binding?.provider ?? defaultRuntime;

  const fallbacks =
    binding?.fallbacks && binding.fallbacks.length > 0
      ? binding.fallbacks
      : binding?.fallback
        ? [binding.fallback]
        : (['local'] as RuntimeProviderId[]);

  return dedupeRuntimeChain([primary, ...fallbacks]);
}

export function firstConfiguredRuntimeId(
  chain: RuntimeProviderId[],
  isConfigured: (id: RuntimeProviderId) => boolean,
): RuntimeProviderId {
  for (const id of chain) {
    if (isConfigured(id)) return id;
  }
  return 'local';
}
