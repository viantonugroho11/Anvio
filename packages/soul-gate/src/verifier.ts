import type { SoulPolicy, SoulPolicyApprover } from '@anvio/core';

/** Reject policy ids that do not appear verbatim in the source document. */
export function verifyPolicyIds(source: string, policy: SoulPolicy): SoulPolicy {
  const verified = structuredClone(policy);

  verified.blockedUsers = verified.blockedUsers.filter((u) => source.includes(u.userId));
  verified.approvers = verified.approvers.filter((a) => source.includes(a.userId));

  if (verified.manager && !source.includes(verified.manager.userId)) {
    verified.manager = undefined;
  }
  if (verified.backupManager && !source.includes(verified.backupManager.userId)) {
    verified.backupManager = undefined;
  }

  verified.allowedZones = verified.allowedZones.map((zone) => ({
    ...zone,
    ids: zone.ids.filter((id) => source.includes(id)),
  }));
  verified.trustedZones = verified.trustedZones.map((zone) => ({
    ...zone,
    ids: zone.ids.filter((id) => source.includes(id)),
  }));

  return verified;
}

export function extractIdsFromLine(line: string): string[] {
  const ids: string[] = [];
  for (const match of line.matchAll(
    /(?:slack|telegram|whatsapp|discord|cli|matrix|teams|mattermost):[^\s,;:]+/gi,
  )) {
    ids.push(match[0]);
  }
  for (const match of line.matchAll(/<@[^>|]+(?:\|[^>]+)?>|U[A-Z0-9]+|C[A-Z0-9]+|G[A-Z0-9]+|\d{5,}/g)) {
    const token = match[0].replace(/^<@/, '').replace(/\|.*>$/, '').replace(/>$/, '');
    if (token) ids.push(token);
  }
  return ids;
}

export function parseApproversSection(lines: string[]): SoulPolicyApprover[] {
  const approvers: SoulPolicyApprover[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ids = extractIdsFromLine(trimmed);
    if (ids.length === 0) continue;
    const scopePart =
      trimmed.includes(':') && /^(slack|telegram|whatsapp|discord|cli):/.test(trimmed.replace(/^-\s*/, ''))
        ? trimmed.replace(/^-\s*/, '').split(':').slice(2).join(':').split(';')[0]?.trim() ?? ''
        : trimmed.split(':')[1]?.split(';')[0]?.trim() ?? '';
    const catchall = /catchall|anything/i.test(trimmed);
    approvers.push({
      channel: '*',
      userId: ids[0]!,
      scope: scopePart,
      catchall,
    });
  }
  return approvers;
}
