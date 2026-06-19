import { z } from 'zod';

export const credentialStatusSchema = z.enum(['active', 'rate_limited', 'disabled']);
export const poolStrategySchema = z.enum(['round_robin', 'least_used', 'random']);
export const rateLimitActionSchema = z.enum(['rotate', 'wait', 'fail']);

export const credentialEntrySchema = z.object({
  id: z.string().min(1),
  encryptedRef: z.string().min(1),
  status: credentialStatusSchema.default('active'),
  quota: z
    .object({
      requestsPerMinute: z.number().int().positive().optional(),
      tokensPerDay: z.number().int().positive().optional(),
    })
    .optional(),
  rateLimitedUntil: z.string().optional(),
});

export const credentialPoolSpecSchema = z.object({
  provider: z.string().min(1),
  strategy: poolStrategySchema.default('round_robin'),
  credentials: z.array(credentialEntrySchema).default([]),
  rotation: z
    .object({
      onRateLimit: rateLimitActionSchema.default('rotate'),
      cooldownSeconds: z.number().int().min(0).default(60),
    })
    .default({}),
  failover: z
    .object({
      enabled: z.boolean().default(false),
      fallbackPool: z.string().optional(),
    })
    .default({}),
});

export const credentialPoolSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('CredentialPool'),
  metadata: z.object({
    slug: z.string().min(1),
  }),
  spec: credentialPoolSpecSchema,
});

export const credentialPoolsIndexSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('CredentialPools'),
  spec: z.object({
    pools: z.array(z.string()).default([]),
  }),
});

export type CredentialStatus = z.infer<typeof credentialStatusSchema>;
export type CredentialEntry = z.infer<typeof credentialEntrySchema>;
export type CredentialPool = z.infer<typeof credentialPoolSchema>;

export function parseCredentialPool(input: unknown): CredentialPool {
  return credentialPoolSchema.parse(input);
}
