import { z } from 'zod';

export const mcpServerSpecSchema = z
  .object({
    /** stdio: executable to spawn. */
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
    /**
     * `http` is a remote server (ADR-0037): Streamable HTTP, falling back to
     * the legacy HTTP+SSE transport when the endpoint rejects a POST.
     */
    transport: z.enum(['stub', 'stdio', 'http']).default('stdio'),
    /** http: server endpoint, e.g. https://mcp.example.com/mcp or …/sse. */
    url: z.string().url().optional(),
    /** http: extra request headers; values may use ${VAR} placeholders. */
    headers: z.record(z.string()).default({}),
    /** When set, only these MCP tool names are exposed to the agent for this server. */
    allowedTools: z.array(z.string()).optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.transport === 'http' && !spec.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'url is required for transport http' });
    }
    if (spec.transport !== 'http' && !spec.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: 'command is required for stdio/stub' });
    }
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
