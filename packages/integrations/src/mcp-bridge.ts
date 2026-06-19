import type { IntegrationRegistry } from './integration-registry.js';

export interface McpToolCall {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolResult {
  serverId: string;
  toolName: string;
  output: unknown;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
}

export class McpBridge {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly stubTools: Record<string, McpToolDescriptor[]> = DEFAULT_STUB_TOOLS,
  ) {}

  async listTools(serverId: string): Promise<McpToolDescriptor[]> {
    const entry = await this.registry.get(serverId);
    if (!entry || !entry.enabled) return [];
    return this.stubTools[serverId] ?? [{ name: 'ping', description: 'Health check' }];
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const entry = await this.registry.get(call.serverId);
    if (!entry) {
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output: null,
        status: 'failed',
        error: `MCP server not found: ${call.serverId}`,
      };
    }
    if (!entry.enabled) {
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output: null,
        status: 'skipped',
        error: 'Integration disabled',
      };
    }

    return {
      serverId: call.serverId,
      toolName: call.toolName,
      output: {
        ok: true,
        server: call.serverId,
        tool: call.toolName,
        args: call.arguments ?? {},
        message: `[MCP stub] ${call.serverId}.${call.toolName} executed`,
      },
      status: 'completed',
    };
  }

  async testServer(serverId: string): Promise<{ ok: boolean; tools: McpToolDescriptor[]; message: string }> {
    const entry = await this.registry.get(serverId);
    if (!entry) {
      return { ok: false, tools: [], message: `Server not configured: ${serverId}` };
    }
    if (!entry.enabled) {
      return { ok: false, tools: [], message: `Server disabled: ${serverId}` };
    }
    const tools = await this.listTools(serverId);
    return { ok: true, tools, message: `Server ${serverId} ready (${tools.length} tools)` };
  }
}

const DEFAULT_STUB_TOOLS: Record<string, McpToolDescriptor[]> = {
  github: [
    { name: 'create_issue', description: 'Create a GitHub issue' },
    { name: 'search_code', description: 'Search repository code' },
  ],
  atlassian: [{ name: 'create_jira_issue', description: 'Create Jira issue' }],
};

export function createMcpBridge(registry: IntegrationRegistry): McpBridge {
  return new McpBridge(registry);
}
