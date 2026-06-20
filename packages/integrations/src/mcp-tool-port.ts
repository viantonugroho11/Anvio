import type {
  BuiltinToolCall,
  BuiltinToolResult,
  ModelToolDefinition,
  RuntimeToolContext,
  RuntimeToolPort,
} from '@anvio/core';
import type { McpBridge } from './mcp-bridge.js';
import {
  formatMcpToolName,
  type McpFirstCallGate,
  parseMcpToolName,
} from './mcp-first-call-gate.js';

export interface McpToolPortOptions {
  mcpBridge: McpBridge;
  gate: McpFirstCallGate;
  /** Pre-loaded MCP tool full names (anvio_mcp__server__tool). */
  mcpToolNames?: string[];
  mcpToolDefinitions?: ModelToolDefinition[];
}

function mapMcpStatus(status: 'completed' | 'failed' | 'skipped'): BuiltinToolResult['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'failed';
    }
  }
}

function pendingApprovalResult(
  call: BuiltinToolCall,
  serverId: string,
  toolName: string,
): BuiltinToolResult {
  const requestId = crypto.randomUUID();
  const summary = `Approve first MCP use: ${serverId}.${toolName}`;
  return {
    name: call.name,
    output: { summary, serverId, toolName, arguments: call.arguments },
    status: 'pending_approval',
    approvalRequestId: requestId,
  };
}

/** Exposes MCP bridge tools to the agent runtime with optional first-call approval. */
export class McpToolPort implements RuntimeToolPort {
  private readonly mcpToolNames: string[];
  private readonly mcpToolDefinitions: ModelToolDefinition[];

  constructor(
    private readonly inner: RuntimeToolPort,
    private readonly options: McpToolPortOptions,
  ) {
    this.mcpToolNames = options.mcpToolNames ?? [];
    this.mcpToolDefinitions = options.mcpToolDefinitions ?? [];
  }

  listTools(): string[] {
    return [...this.inner.listTools(), ...this.mcpToolNames];
  }

  getToolInstructions(): string {
    if (this.mcpToolNames.length === 0) return this.inner.getToolInstructions();
    const mcpLines = this.mcpToolDefinitions
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    return [
      this.inner.getToolInstructions(),
      [
        '## MCP tools',
        'First use of each MCP tool per session may require human approval.',
        'Tool names use the form anvio_mcp__{server}__{tool}.',
        '',
        mcpLines,
      ].join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getModelToolDefinitions(): ModelToolDefinition[] {
    const inner = this.inner.getModelToolDefinitions?.() ?? [];
    return [...inner, ...this.mcpToolDefinitions];
  }

  async call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult> {
    if (!call.name.startsWith('anvio_mcp__')) {
      return this.inner.call(call, ctx);
    }

    const parsed = parseMcpToolName(call.name);
    if (!parsed) {
      return {
        name: call.name,
        output: null,
        status: 'failed',
        error: 'Invalid MCP tool name',
      };
    }

    const { serverId, toolName } = parsed;
    if (
      this.options.gate.requiresApproval() &&
      !(await this.options.gate.isApproved(ctx.sessionId, serverId, toolName))
    ) {
      return pendingApprovalResult(call, serverId, toolName);
    }

    const result = await this.options.mcpBridge.callTool({
      serverId,
      toolName,
      arguments: call.arguments,
    });

    return {
      name: call.name,
      output: result.output,
      status: mapMcpStatus(result.status),
      error: result.error,
    };
  }
}

export async function loadMcpToolCatalog(
  mcpBridge: McpBridge,
  serverIds: string[],
): Promise<{ names: string[]; definitions: ModelToolDefinition[] }> {
  const names: string[] = [];
  const definitions: ModelToolDefinition[] = [];

  for (const serverId of serverIds) {
    const tools = await mcpBridge.listTools(serverId);
    for (const tool of tools) {
      const fullName = formatMcpToolName(serverId, tool.name);
      names.push(fullName);
      definitions.push({
        name: fullName,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
      });
    }
  }

  return { names, definitions };
}

export function createMcpToolPort(inner: RuntimeToolPort, options: McpToolPortOptions): RuntimeToolPort {
  return new McpToolPort(inner, options);
}

export { formatMcpToolName, parseMcpToolName };
