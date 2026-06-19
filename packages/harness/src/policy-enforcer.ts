import type { ChannelType, SoulPolicy, HarnessTrustTier } from '@anvio/core';
import { matchesChannelRef } from '@anvio/core';

export function resolveTrustTier(
  policy: SoulPolicy,
  channel: ChannelType | string,
  zoneId?: string,
): HarnessTrustTier {
  if (!zoneId) return 'restricted';

  const inTrusted = policy.trustedZones.some(
    (z) => matchesChannelRef(z.channel, channel) && z.ids.includes(zoneId),
  );
  if (inTrusted) return 'trusted';

  const inAllowed = policy.allowedZones.some(
    (z) => matchesChannelRef(z.channel, channel) && z.ids.includes(zoneId),
  );
  if (inAllowed) return 'allowed';

  return 'restricted';
}

export function isUserBlocked(
  policy: SoulPolicy,
  channel: ChannelType | string,
  userId: string,
): boolean {
  return policy.blockedUsers.some(
    (u) => matchesChannelRef(u.channel, channel) && u.userId === userId,
  );
}

export function isManagerUser(
  policy: SoulPolicy,
  channel: ChannelType | string,
  userId: string,
): boolean {
  const managerIds = [policy.manager?.userId, policy.backupManager?.userId].filter(Boolean);
  return managerIds.some(
    (id) =>
      id === userId &&
      (matchesChannelRef(policy.manager?.channel ?? '*', channel) ||
        matchesChannelRef(policy.backupManager?.channel ?? '*', channel)),
  );
}

export function canAccessRestrictedZone(
  policy: SoulPolicy,
  channel: ChannelType | string,
  userId: string,
  trustTier: HarnessTrustTier,
  dmPolicy: 'anyone' | 'manager_only',
  isDm: boolean,
): boolean {
  if (trustTier === 'trusted' || trustTier === 'allowed') return true;
  if (isDm && dmPolicy === 'manager_only') {
    return isManagerUser(policy, channel, userId);
  }
  if (!isDm && trustTier === 'restricted') {
    return isManagerUser(policy, channel, userId);
  }
  return true;
}
