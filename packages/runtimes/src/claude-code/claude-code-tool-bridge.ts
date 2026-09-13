import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ModelToolDefinition, RuntimeToolContext, RuntimeToolPort } from '@anvio/core';

/**
 * Name of the in-process MCP server the harness/tool-gateway surface is
 * exposed through. The SDK namespaces every tool it serves, so a tool
 * called `anvio_channel__reply` reaches the model as
 * `mcp__anvio__anvio_channel__reply` — instructions have to use that form
 * or the model calls a name that does not exist (issue #69).
 */
export const ANVIO_MCP_SERVER_NAME = 'anvio';

export function mcpToolName(toolName: string): string {
  return `mcp__${ANVIO_MCP_SERVER_NAME}__${toolName}`;
}

type ZodRawShape = Record<string, z.ZodTypeAny>;

function leafSchema(property: unknown): z.ZodTypeAny {
  const type =
    property && typeof property === 'object' && 'type' in property
      ? (property as { type?: unknown }).type
      : undefined;
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(z.unknown());
    case 'object':
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

/**
 * The tool gateway describes arguments as JSON Schema; the SDK's `tool()`
 * wants a Zod raw shape. Only the top level is translated — nested shapes
 * fall back to permissive types, which is enough for validation to pass
 * through to the gateway, where the real checks already live.
 */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): ZodRawShape {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [],
  );

  const shape: ZodRawShape = {};
  for (const [key, property] of Object.entries(properties)) {
    const base = leafSchema(property);
    shape[key] = required.has(key) ? base : base.optional();
  }
  return shape;
}

/**
 * Expose the runtime tool port (built-in gateway + harness channel tools)
 * to the Claude Code SDK as an in-process MCP server. Without this the
 * vendor runtime had no `anvio_channel__reply` and no
 * `anvio_channel__request_approval` at all — the whole harness tool surface
 * was unreachable from the default runtime (issue #69).
 */
export function createAnvioMcpServer(
  toolPort: RuntimeToolPort,
  ctx: RuntimeToolContext,
): McpServerConfig {
  return createSdkMcpServer({
    name: ANVIO_MCP_SERVER_NAME,
    tools: buildAnvioToolDefinitions(toolPort, ctx),
  });
}

/** Exposed separately so the bridging behaviour is testable without a server. */
export function buildAnvioToolDefinitions(toolPort: RuntimeToolPort, ctx: RuntimeToolContext) {
  const definitions: ModelToolDefinition[] = toolPort.getModelToolDefinitions?.() ?? [];

  return definitions.map((definition) =>
    tool(
      definition.name,
      definition.description,
      jsonSchemaToZodShape(definition.inputSchema),
      async (args) => {
        const result = await toolPort.call(
          { name: definition.name, arguments: (args ?? {}) as Record<string, unknown> },
          ctx,
        );
        const payload =
          result.status === 'failed'
            ? (result.error ?? `${definition.name} failed`)
            : JSON.stringify(result.output ?? null);
        return {
          content: [{ type: 'text' as const, text: payload }],
          isError: result.status === 'failed',
        };
      },
    ),
  );
}
