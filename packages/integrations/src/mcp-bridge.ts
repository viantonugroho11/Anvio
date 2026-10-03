import type { IntegrationEntry, IntegrationRegistry } from './integration-registry.js';
import { createMcpHttpClient, McpHttpClient } from './mcp-http-client.js';
import { createMcpStdioClient, McpStdioClient } from './mcp-stdio-client.js';

type McpClient = McpStdioClient | McpHttpClient;
type LiveTransport = 'stdio' | 'http';

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
  transport?: 'stub' | LiveTransport;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
}

export interface McpServerHealth {
  serverId: string;
  enabled: boolean;
  transport: 'stub' | LiveTransport;
  connected: boolean;
  restartCount: number;
  toolCount: number;
  message: string;
}

export class McpBridge {
  private readonly clients = new Map<string, McpClient>();

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
    const transport = liveTransport(entry) ?? 'stub';
    return { ok: true, tools, message: `Server ${serverId} ready (${tools.length} tools, ${transport})` };
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.close()));
    this.clients.clear();
  }

  /** Health snapshot for configured MCP servers (stdio pool state + tool counts). */
  async getHealthReport(): Promise<McpServerHealth[]> {
    const entries = await this.registry.list();
    const report: McpServerHealth[] = [];

    for (const entry of entries) {
      if (!entry.enabled) {
        report.push({
          serverId: entry.id,
          enabled: false,
          transport: entry.server.transport ?? 'stdio',
          connected: false,
          restartCount: 0,
          toolCount: 0,
          message: 'disabled',
        });
        continue;
      }

      const transport = liveTransport(entry) ?? 'stub';
      const client = this.clients.get(entry.id);
      const tools = await this.listTools(entry.id);
      report.push({
        serverId: entry.id,
        enabled: true,
        transport,
        connected: client?.isConnected() ?? false,
        restartCount: client?.getRestartCount() ?? 0,
        toolCount: tools.length,
        message: `${transport} (${tools.length} tools)`,
      });
    }

    return report;
  }

  private async tryListStdioTools(entry: IntegrationEntry): Promise<McpToolDescriptor[] | null> {
    const transport = liveTransport(entry);
    if (!transport) return null;
    try {
      const client = await this.getClient(entry);
      const tools = await client.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
      }));
    } catch (error) {
      this.invalidateStdioClient(entry.id);
      // A stub `ping` stands in for a broken stdio server (existing behaviour);
      // for a remote server that would advertise a tool that cannot exist.
      if (transport === 'http') {
        console.error(`[mcp-http] ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
      return null;
    }
  }

  private async tryCallStdioTool(
    entry: IntegrationEntry,
    call: McpToolCall,
  ): Promise<McpToolResult | null> {
    const transport = liveTransport(entry);
    if (!transport) return null;
    try {
      const client = await this.getClient(entry);
      const output = await client.callTool(call.toolName, call.arguments ?? {});
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output,
        status: 'completed',
        transport,
      };
    } catch (error) {
      this.invalidateStdioClient(entry.id);
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        output: null,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        transport,
      };
    }
  }

  /** Drop a cached stdio client so the next call respawns from current config. */
  invalidate(serverId: string): void {
    this.invalidateStdioClient(serverId);
  }

  private invalidateStdioClient(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.invalidate();
      this.clients.delete(serverId);
    }
  }

  private async getClient(entry: IntegrationEntry): Promise<McpClient> {
    const existing = this.clients.get(entry.id);
    if (existing) return existing;

    const client: McpClient =
      entry.server.transport === 'http'
        ? createMcpHttpClient(entry.server)
        : createMcpStdioClient(entry.server);
    this.clients.set(entry.id, client);
    await client.start();
    return client;
  }
}

function liveTransport(entry: IntegrationEntry): LiveTransport | null {
  if (process.env.ANVIO_MCP_STUB === '1') return null;
  if (entry.server.transport === 'stub') return null;
  return entry.server.transport === 'http' ? 'http' : 'stdio';
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

export { createMcpStdioClient, McpStdioClient, createMcpHttpClient, McpHttpClient };
