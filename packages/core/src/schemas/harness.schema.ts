import { z } from 'zod';

export const harnessEngageTriggerSchema = z.enum([
  'always',
  'mention',
  'command',
  'never',
]);

export const harnessChannelProfileSchema = z.object({
  name: z.string().min(1),
  channels: z.array(z.string()).default([]),
  engageOn: harnessEngageTriggerSchema.default('always'),
  disengageOn: z.enum(['mention_other', 'command_stop', 'never']).default('never'),
  dmPolicy: z.enum(['anyone', 'manager_only']).default('anyone'),
});

export const harnessToolSurfaceSchema = z.enum(['all', 'mcp_and_channel']);

export const harnessDefaultsSchema = z.object({
  enabled: z.boolean().default(false),
  soulSlug: z.string().optional(),
  suppressRawOutput: z.boolean().default(true),
  /** When mcp_and_channel, hide built-in gateway tools; agent uses MCP + channel tools only. */
  toolSurface: harnessToolSurfaceSchema.default('all'),
  idleMinutes: z.number().int().positive().default(15),
  resumeSessions: z.boolean().default(true),
  connectBroker: z
    .object({
      enabled: z.boolean().default(false),
      encryptionKeyEnv: z.string().default('ANVIO_CONNECTION_ENCRYPTION_KEY'),
      defaultTtlSeconds: z.number().int().positive().default(3600),
    })
    .default({}),
});

export const harnessConfigSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('HarnessDefaults'),
  metadata: z.object({
    name: z.string().default('default'),
  }),
  spec: harnessDefaultsSchema,
});

export const harnessProfilesSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('HarnessChannelProfiles'),
  metadata: z.object({
    name: z.string().default('default'),
  }),
  spec: z.object({
    profiles: z.array(harnessChannelProfileSchema).default([]),
  }),
});

export type HarnessDefaults = z.infer<typeof harnessDefaultsSchema>;
export type HarnessChannelProfile = z.infer<typeof harnessChannelProfileSchema>;
export type HarnessConfig = z.infer<typeof harnessConfigSchema>;
export type HarnessProfilesConfig = z.infer<typeof harnessProfilesSchema>;

export function parseHarnessConfig(input: unknown): HarnessConfig {
  return harnessConfigSchema.parse(input);
}

export function parseHarnessProfiles(input: unknown): HarnessProfilesConfig {
  return harnessProfilesSchema.parse(input);
}
