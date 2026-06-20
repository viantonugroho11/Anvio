const MCP_TOOL_PREFIX = 'anvio_mcp__';

export function formatMcpToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__${toolName}`;
}

export function parseMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
  if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = fullName.slice(MCP_TOOL_PREFIX.length);
  const splitIndex = rest.indexOf('__');
  if (splitIndex <= 0) return null;
  return {
    serverId: rest.slice(0, splitIndex),
    toolName: rest.slice(splitIndex + 2),
  };
}

export function mcpApprovalKey(serverId: string, toolName: string): string {
  return `${serverId}/${toolName}`;
}

export interface McpFirstCallGateOptions {
  enabled?: boolean;
  getApproved?: (sessionId: string) => Promise<string[]> | string[];
  persistApproved?: (sessionId: string, keys: string[]) => Promise<void> | void;
}

/** Tracks first-use approval for MCP tools per session. */
export class McpFirstCallGate {
  private readonly memory = new Map<string, Set<string>>();
  private readonly enabled: boolean;
  private readonly getApproved?: McpFirstCallGateOptions['getApproved'];
  private readonly persistApproved?: McpFirstCallGateOptions['persistApproved'];

  constructor(options: McpFirstCallGateOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.getApproved = options.getApproved;
    this.persistApproved = options.persistApproved;
  }

  async isApproved(sessionId: string, serverId: string, toolName: string): Promise<boolean> {
    const key = mcpApprovalKey(serverId, toolName);
    if (this.memory.get(sessionId)?.has(key)) return true;
    const persisted = await this.getApproved?.(sessionId);
    return Array.isArray(persisted) && persisted.includes(key);
  }

  async approve(sessionId: string, serverId: string, toolName: string): Promise<void> {
    const key = mcpApprovalKey(serverId, toolName);
    const set = this.memory.get(sessionId) ?? new Set<string>();
    set.add(key);
    this.memory.set(sessionId, set);

    const persisted = new Set(await this.getApproved?.(sessionId));
    persisted.add(key);
    await this.persistApproved?.(sessionId, [...persisted]);
  }

  async approveToolName(sessionId: string, fullToolName: string): Promise<boolean> {
    const parsed = parseMcpToolName(fullToolName);
    if (!parsed) return false;
    await this.approve(sessionId, parsed.serverId, parsed.toolName);
    return true;
  }

  requiresApproval(): boolean {
    return this.enabled;
  }

  resetSession(sessionId: string): void {
    this.memory.delete(sessionId);
  }
}

export function createMcpFirstCallGate(options?: McpFirstCallGateOptions): McpFirstCallGate {
  return new McpFirstCallGate(options);
}
