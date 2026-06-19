import type { SoulPolicyApprover } from '@anvio/core';

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with']);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

export function approverMatchesSummary(approver: SoulPolicyApprover, summary: string): boolean {
  if (approver.catchall) return true;
  const scopeTokens = tokenize(approver.scope);
  if (scopeTokens.size === 0) return false;
  const summaryTokens = tokenize(summary);
  for (const token of scopeTokens) {
    if (summaryTokens.has(token)) return true;
  }
  return false;
}

export function resolveApproversForSummary(
  approvers: SoulPolicyApprover[],
  channel: string,
  summary: string,
): SoulPolicyApprover[] {
  return approvers.filter(
    (a) => (a.channel === '*' || a.channel === channel) && approverMatchesSummary(a, summary),
  );
}

export function isAuthorizedApprover(
  approvers: SoulPolicyApprover[],
  channel: string,
  summary: string,
  userId: string,
): boolean {
  const eligible = resolveApproversForSummary(approvers, channel, summary);
  if (eligible.some((a) => a.catchall && a.userId === userId)) return true;
  return eligible.some((a) => a.userId === userId);
}
