export interface McpHandlerOptions {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

export async function runMcpHandler(
  _payload: Record<string, unknown>,
  options: McpHandlerOptions,
): Promise<{ ok: boolean; result?: unknown }> {
  // MCP hook execution wired in Phase E (integrations). Stub returns not-configured.
  return {
    ok: false,
    result: {
      message: `MCP hook stub — configure server "${options.server}" tool "${options.tool}" in Phase E`,
    },
  };
}
