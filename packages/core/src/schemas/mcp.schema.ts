import { z } from 'zod';

export const mcpServerSpecSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
});

export const mcpConfigSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('McpConfig'),
  metadata: z.object({
    name: z.string().default('default'),
  }),
  spec: z.object({
    firstCallApproval: z.boolean().default(true),
    servers: z.record(mcpServerSpecSchema).default({}),
  }),
});

export type McpServerSpec = z.infer<typeof mcpServerSpecSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

export function parseMcpConfig(input: unknown): McpConfig {
  return mcpConfigSchema.parse(input);
}
