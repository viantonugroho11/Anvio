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
  provider: z.enum(['filesystem', 'sqlite', 'postgresql', 'qdrant', 'redis']).default('filesystem'),
  basePath: z.string().default('memory'),
});

export const eventsConfigSchema = z.object({
  provider: z.enum(['local', 'nats']).default('local'),
  url: z.string().optional(),
});

export const workspaceSpecSchema = z.object({
  auth: authConfigSchema.default({ enabled: false, provider: 'none' }),
  storage: storageConfigSchema.default({ provider: 'filesystem', basePath: '.' }),
  memory: memoryConfigSchema.default({ provider: 'filesystem', basePath: 'memory' }),
  events: eventsConfigSchema.default({ provider: 'local' }),
  defaultAgent: z.string().optional(),
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
