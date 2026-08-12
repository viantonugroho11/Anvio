import { z } from 'zod';

/**
 * Epic 5 F1 — Tool Bus policy layer.
 *
 * A ToolPolicy declares which tools an agent may invoke and under what conditions.
 * Policies compose in a fixed precedence chain: **default → tenant → project → agent**.
 * Later layers override earlier ones per-key; `mergeToolPolicies` implements this.
 *
 * The runtime resolves the effective policy once per session, then consults
 * `isToolAllowed(policy, toolName)` at every tool call. Denials produce a
 * typed rejection reason (`allowedIsExhaustive`, `blocked`, `patternMismatch`).
 */

export const toolPolicySchema = z
  .object({
    /** If set, only tools whose name matches one of these patterns are allowed. Glob (`fs_*`) OK. */
    allowed: z.array(z.string()).optional(),
    /** Explicit denies, evaluated AFTER `allowed`. Denies win over allowed. */
    denied: z.array(z.string()).default([]),
    /** Per-tool argument-shape overrides — future: JSON-Schema patches. */
    argumentOverrides: z.record(z.string(), z.unknown()).default({}),
    /** Require explicit user approval for these tools even when allowed. */
    requireApproval: z.array(z.string()).default([]),
    /** Free-form annotation for auditing. */
    note: z.string().optional(),
  })
  .strict();

export type ToolPolicy = z.infer<typeof toolPolicySchema>;

export type PolicyLayer = 'default' | 'tenant' | 'project' | 'agent';

/** Layers are ordered: index 0 (default) is weakest, last is strongest. */
export const POLICY_LAYER_ORDER: readonly PolicyLayer[] = ['default', 'tenant', 'project', 'agent'];

export interface LayeredPolicy {
  layer: PolicyLayer;
  policy: ToolPolicy;
}

/**
 * Merge layered policies with layer-later-wins semantics per key.
 *
 * - `allowed`: intersect when both defined; when only one defines it, use that one.
 *   Rationale: a project narrowing `allowed` is a valid tightening; an agent
 *   over-broadening its own allow-list would silently escape the project's contract.
 * - `denied`: union across all layers. Denies never soften.
 * - `argumentOverrides`, `note`: last non-empty layer wins.
 * - `requireApproval`: union — approval is a safety guard that only tightens.
 */
export function mergeToolPolicies(layered: LayeredPolicy[]): ToolPolicy {
  const sorted = [...layered].sort(
    (a, b) => POLICY_LAYER_ORDER.indexOf(a.layer) - POLICY_LAYER_ORDER.indexOf(b.layer),
  );
  let allowed: string[] | undefined;
  const denied = new Set<string>();
  const requireApproval = new Set<string>();
  let argumentOverrides: Record<string, unknown> = {};
  let note: string | undefined;

  for (const { policy } of sorted) {
    if (policy.allowed) {
      if (!allowed) {
        allowed = [...policy.allowed];
      } else {
        const prevAllowed = allowed;
        allowed = policy.allowed.filter((candidate) =>
          prevAllowed.some((p) => matches(candidate, p)),
        );
      }
    }
    for (const d of policy.denied) denied.add(d);
    for (const a of policy.requireApproval) requireApproval.add(a);
    if (Object.keys(policy.argumentOverrides).length > 0) {
      argumentOverrides = { ...argumentOverrides, ...policy.argumentOverrides };
    }
    if (policy.note) note = policy.note;
  }

  return {
    allowed,
    denied: [...denied],
    requireApproval: [...requireApproval],
    argumentOverrides,
    ...(note ? { note } : {}),
  };
}

export type PolicyDecision =
  | { allowed: true; requiresApproval: boolean }
  | { allowed: false; reason: 'blocked' | 'notInAllowList' };

export function decideToolCall(policy: ToolPolicy, toolName: string): PolicyDecision {
  if (policy.denied.some((p) => matches(toolName, p))) {
    return { allowed: false, reason: 'blocked' };
  }
  if (policy.allowed && !policy.allowed.some((p) => matches(toolName, p))) {
    return { allowed: false, reason: 'notInAllowList' };
  }
  return {
    allowed: true,
    requiresApproval: policy.requireApproval.some((p) => matches(toolName, p)),
  };
}

/** Glob-lite: `*` matches any run of chars. Case-sensitive, no `?` or char classes. */
function matches(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const re = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return re.test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
