import { z } from 'zod';
import type { ChannelType } from '../types/common.js';

export const soulPolicyIdentitySchema = z.object({
  name: z.string().default('Agent'),
  role: z.string().optional(),
  voice: z.string().optional(),
});

export const soulPolicyUserRefSchema = z.object({
  channel: z.string().default('*'),
  userId: z.string().min(1),
  handle: z.string().optional(),
});

export const soulPolicyZoneSchema = z.object({
  channel: z.string().default('*'),
  ids: z.array(z.string()).default([]),
});

export const soulPolicyApproverSchema = z.object({
  channel: z.string().default('*'),
  userId: z.string().min(1),
  scope: z.string().default(''),
  catchall: z.boolean().default(false),
});

export const soulPolicySchema = z.object({
  soulSlug: z.string().optional(),
  identity: soulPolicyIdentitySchema.default({}),
  manager: soulPolicyUserRefSchema.optional(),
  backupManager: soulPolicyUserRefSchema.optional(),
  allowedZones: z.array(soulPolicyZoneSchema).default([]),
  trustedZones: z.array(soulPolicyZoneSchema).default([]),
  blockedUsers: z.array(soulPolicyUserRefSchema).default([]),
  approvers: z.array(soulPolicyApproverSchema).default([]),
  redactPatterns: z.array(z.string()).default([]),
  approvalTimeoutSeconds: z.number().int().nonnegative().default(0),
  mandate: z.string().default(''),
  values: z.array(z.string()).default([]),
});

export type SoulPolicy = z.infer<typeof soulPolicySchema>;
export type SoulPolicyApprover = z.infer<typeof soulPolicyApproverSchema>;

export function parseSoulPolicy(input: unknown): SoulPolicy {
  return soulPolicySchema.parse(input);
}

export function defaultSoulPolicy(slug?: string): SoulPolicy {
  return parseSoulPolicy({
    soulSlug: slug,
    identity: { name: 'Agent' },
    mandate: 'Assist users within configured boundaries.',
  });
}

export function matchesChannelRef(refChannel: string, channel: ChannelType | string): boolean {
  return refChannel === '*' || refChannel === channel;
}
