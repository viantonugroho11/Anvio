import { z } from 'zod';

export const mcpServerSpecSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
  transport: z.enum(['stub', 'stdio']).default('stdio'),
  /** When set, only these MCP tool names are exposed to the agent for this server. */
  allowedTools: z.array(z.string()).optional(),
});

export const mcpConfigSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('McpConfig'),
  metadata: z.object({
    name: z.string().default('default'),
  }),
  spec: z.object({
    firstCallApproval: z.boolean().default(true),
    /**
     * Executables the `mcp_manage` tool may register (ADR-0036). An agent can
     * only add a server whose `command` basename is listed here; humans editing
     * servers.yaml directly are not constrained.
     */
    agentAllowedCommands: z.array(z.string()).default(['npx', 'uvx', 'node', 'python3', 'docker']),
    servers: z.record(mcpServerSpecSchema).default({}),
  }),
});

export type McpServerSpec = z.infer<typeof mcpServerSpecSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

export function parseMcpConfig(input: unknown): McpConfig {
  return mcpConfigSchema.parse(input);
}
