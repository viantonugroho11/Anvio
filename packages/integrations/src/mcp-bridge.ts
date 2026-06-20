import type { IntegrationEntry, IntegrationRegistry } from './integration-registry.js';
import { createMcpStdioClient, McpStdioClient } from './mcp-stdio-client.js';

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
  transport?: 'stub' | 'stdio';
}

export interface McpToolDescriptor {
  name: string;
  description: string;
}

export class McpBridge {
  private readonly clients = new Map<string, McpStdioClient>();

  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly stubTools: Record<string, McpToolDescriptor[]> = DEFAULT_STUB_TOOLS,
  ) {}

  async listTools(serverId: string): Promise<McpToolDescriptor[]> {
    const entry = await this.registry.get(serverId);
    if (!entry || !entry.enabled) return [];

    const stdioTools = await this.tryListStdioTools(entry);
    if (stdioTools) return stdioTools;

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

    const stdioResult = await this.tryCallStdioTool(entry, call);
    if (stdioResult) return stdioResult;

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
      transport: 'stub',
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
    const transport = usesStdioTransport(entry) ? 'stdio' : 'stub';
    return { ok: true, tools, message: `Server ${serverId} ready (${tools.length} tools, ${transport})` };
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.close()));
    this.clients.clear();
  }

  private async tryListStdioTools(entry: IntegrationEntry): Promise<McpToolDescriptor[] | null> {
    if (!usesStdioTransport(entry)) return null;
    try {
      const client = await this.getStdioClient(entry);
      const tools = await client.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
      }));
    } catch {
      this.invalidateStdioClient(entry.id);
      return null;
    }
  }

  private async tryCallStdioTool(
    entry: IntegrationEntry,
    call: McpToolCall,
  ): Promise<McpToolResult | null> {
    if (!usesStdioTransport(entry)) return null;
    try {
      const client = await this.getStdioClient(entry);
      const output = await client.callTool(call.toolName, call.arguments ?? {});
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output,
        status: 'completed',
        transport: 'stdio',
      };
    } catch (error) {
      this.invalidateStdioClient(entry.id);
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output: null,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        transport: 'stdio',
      };
    }
  }

  private invalidateStdioClient(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.invalidate();
      this.clients.delete(serverId);
    }
  }

  private async getStdioClient(entry: IntegrationEntry): Promise<McpStdioClient> {
    const existing = this.clients.get(entry.id);
    if (existing) return existing;

    const client = createMcpStdioClient(entry.server);
    this.clients.set(entry.id, client);
    await client.start();
    return client;
  }
}

function usesStdioTransport(entry: IntegrationEntry): boolean {
  if (process.env.ANVIO_MCP_STUB === '1') return false;
  return entry.server.transport !== 'stub';
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

export { createMcpStdioClient, McpStdioClient };
