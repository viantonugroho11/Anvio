import { z } from 'zod';

export const authConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['none', 'oauth2', 'jwt']).default('none'),
  oauth2: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      issuer: z.string().optional(),
    })
    .optional(),
});

export const storageConfigSchema = z.object({
  provider: z.enum(['filesystem', 'sqlite', 'postgresql', 's3']).default('filesystem'),
  basePath: z.string().default('.'),
  connectionString: z.string().optional(),
  s3: z
    .object({
      endpoint: z.string().optional(),
      bucket: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
    })
    .optional(),
});

export const memoryConfigSchema = z.object({
  provider: z
    .enum(['filesystem', 'sqlite', 'postgresql', 'qdrant', 'redis', 'honcho'])
    .default('filesystem'),
  basePath: z.string().default('memory'),
});

export const runtimeConfigSchema = z.object({
  default: z.enum(['local', 'cursor', 'claude-code', 'codex']).default('local'),
});

export const executionConfigSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().default(30000),
  networkEnabled: z.boolean().default(false),
});

export const credentialsConfigSchema = z.object({
  encryption: z.enum(['disabled', 'enabled']).default('disabled'),
});

export const acpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(8765),
  host: z.string().default('127.0.0.1'),
});

export const eventsConfigSchema = z.object({
  provider: z.enum(['local', 'nats']).default('local'),
  url: z.string().optional(),
});

export const channelProviderSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  defaultAgent: z.string().optional(),
});

export const slackChannelSchema = channelProviderSchema.extend({
  appToken: z.string().optional(),
});

export const whatsappChannelSchema = channelProviderSchema.extend({
  accessToken: z.string().optional(),
  phoneNumberId: z.string().optional(),
  verifyToken: z.string().optional(),
});

export const channelsConfigSchema = z.object({
  telegram: channelProviderSchema.optional(),
  discord: channelProviderSchema.optional(),
  whatsapp: whatsappChannelSchema.optional(),
  slack: slackChannelSchema.optional(),
});

export const worktreesConfigSchema = z.object({
  enabled: z.boolean().default(false),
  repoPath: z.string().default('..'),
});

export const workspaceSpecSchema = z.object({
  auth: authConfigSchema.default({ enabled: false, provider: 'none' }),
  storage: storageConfigSchema.default({ provider: 'filesystem', basePath: '.' }),
  memory: memoryConfigSchema.default({ provider: 'filesystem', basePath: 'memory' }),
  events: eventsConfigSchema.default({ provider: 'local' }),
  runtime: runtimeConfigSchema.default({ default: 'local' }),
  execution: executionConfigSchema.default({ defaultTimeoutMs: 30000, networkEnabled: false }),
  credentials: credentialsConfigSchema.default({ encryption: 'disabled' }),
  acp: acpConfigSchema.default({ enabled: false, port: 8765, host: '127.0.0.1' }),
  channels: channelsConfigSchema.optional(),
  worktrees: worktreesConfigSchema.default({ enabled: false, repoPath: '..' }),
  defaultAgent: z.string().optional(),
  defaultSoul: z.string().optional(),
  defaultUserId: z.string().default('local-user'),
});

export const workspaceDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Workspace'),
  metadata: z.object({
    name: z.string().default('default'),
    version: z.string().default('1.0.0'),
  }),
  spec: workspaceSpecSchema,
});

export type WorkspaceDefinition = z.infer<typeof workspaceDefinitionSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export function parseWorkspaceDefinition(input: unknown): WorkspaceDefinition {
  return workspaceDefinitionSchema.parse(input);
}
