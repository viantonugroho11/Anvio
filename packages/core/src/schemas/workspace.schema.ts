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
  fts: z.boolean().default(false),
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

export const teamsChannelSchema = channelProviderSchema.extend({
  appId: z.string().optional(),
  appPassword: z.string().optional(),
  serviceUrl: z.string().optional(),
});

export const matrixChannelSchema = channelProviderSchema.extend({
  homeserverUrl: z.string().optional(),
  accessToken: z.string().optional(),
  userId: z.string().optional(),
});

export const emailChannelSchema = channelProviderSchema.extend({
  imapHost: z.string().optional(),
  smtpHost: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

export const signalChannelSchema = channelProviderSchema.extend({
  signalCliPath: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export const googleChatChannelSchema = channelProviderSchema.extend({
  webhookUrl: z.string().optional(),
  serviceAccountPath: z.string().optional(),
  space: z.string().optional(),
});

export const feishuChannelSchema = channelProviderSchema.extend({
  webhookUrl: z.string().optional(),
});

export const smsChannelSchema = channelProviderSchema.extend({
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
  fromNumber: z.string().optional(),
});

export const channelsConfigSchema = z.object({
  telegram: channelProviderSchema.optional(),
  discord: channelProviderSchema.optional(),
  whatsapp: whatsappChannelSchema.optional(),
  slack: slackChannelSchema.optional(),
  teams: teamsChannelSchema.optional(),
  matrix: matrixChannelSchema.optional(),
  email: emailChannelSchema.optional(),
  signal: signalChannelSchema.optional(),
  googleChat: googleChatChannelSchema.optional(),
  feishu: feishuChannelSchema.optional(),
  sms: smsChannelSchema.optional(),
  mattermost: channelProviderSchema
    .extend({
      serverUrl: z.string().optional(),
      botToken: z.string().optional(),
    })
    .optional(),
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
