# MCP Architecture

Anvio is an **MCP client**. It connects agents to external MCP servers and exposes their tools through the tool loop. Anvio does not run an MCP server itself.

## Components

| Component            | Location                                            | Responsibility                                                                                                                                                                     |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration registry | `packages/integrations/src/integration-registry.ts` | Loads `workspace/mcp/servers.yaml`; add, enable, disable and remove servers at runtime                                                                                             |
| `McpBridge`          | `packages/integrations/src/mcp-bridge.ts`           | Pools one client per server; `listTools`, `callTool`, `invalidate`, `close`                                                                                                        |
| stdio client         | `packages/integrations/src/mcp-stdio-client.ts`     | Spawns the server process. Newline-delimited JSON-RPC (MCP stdio transport); `Content-Length` frames are still accepted from older servers. 30 s request timeout; respawn on crash |
| HTTP client          | `packages/integrations/src/mcp-http-client.ts`      | Remote servers by URL ([ADR-0037](adr/0037-remote-mcp-servers-over-http.md))                                                                                                       |
| Tool catalog / port  | `packages/platform`                                 | MCP tools appear to agents as `anvio_mcp__<server>__<tool>`                                                                                                                        |
| First-call gate      | `packages/platform` (`mcpFirstCallGate`)            | The first call to each MCP tool in a session requires human approval; the run pauses and resumes after the decision                                                                |

The clients are in-house and are not built on the official SDK. The de facto decision is recorded in [ADR-0039](adr/0039-in-house-mcp-client.md) (Proposed). Conformance is checked by an end-to-end test against a server built with `@modelcontextprotocol/sdk` (`tests/integration/e2e/mcp-approval.e2e.integration.spec.ts`).

## Behaviour

- **Agent-managed servers.** With the `mcp_manage` tool enabled (off by default), agents can register and toggle servers without a restart ([ADR-0036](adr/0036-agent-managed-skills-and-mcp-servers.md)).
- **Failure handling.**
  - A server binary that is missing or crashes is logged and does not stop the platform.
  - A failed request rejects its pending calls.
  - Server processes are terminated on `platform.shutdown()`.
- **Environment.** stdio servers currently inherit the full process environment, including every API key ([ROADMAP T-047](ROADMAP.md#p0-security-and-correctness)). Only run MCP servers you trust.

## Configuration

See [71 — MCP setup guide](71-mcp-setup-guide.md). CLI: `anvio mcp list|test|health|preset`.
