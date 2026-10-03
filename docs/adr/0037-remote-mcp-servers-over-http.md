# ADR-0037: Remote MCP servers over HTTP

- **Status:** Accepted
- **Date:** 2026-10-03
- **Related:** ADR-0006 (MCP architecture), ADR-0036 (agent-managed MCP servers)

## Context

`McpServerSpec.transport` was `stub | stdio`. Hosted MCP servers, which are handed out as a URL (`https://…/mcp`, `…/sse`), could not be registered at all, so "add this MCP: <link>" failed for the most common kind of link.

## Decision

- Add `transport: http` with `url` and `headers` (values may use `${VAR}` placeholders, resolved at request time). `command` becomes optional; a schema refinement requires `command` for stdio/stub and `url` for http.
- New `McpHttpClient`, with the same surface as `McpStdioClient` so `McpBridge` pools either:
  - **Streamable HTTP** (spec 2025-03-26): JSON-RPC by POST, reply as JSON or as an SSE stream, `Mcp-Session-Id` carried after initialize, and a 404 on a live session re-initialises.
  - **Legacy HTTP+SSE fallback**: when the initialize POST gets a 4xx other than 401/403, the client opens a GET event stream, reads the `endpoint` event, and posts to it. Replies arrive on the stream.
- For http servers, the bridge no longer falls back to the stub `ping` tool when listing fails. It returns no tools and logs the error, so a broken remote server is not advertised as working. Stdio behaviour is unchanged.
- `mcp_manage add` accepts `url` and `headers`. The url must be `https`; plain `http` is allowed only for localhost. The `agentAllowedCommands` allow-list does not apply, because nothing runs locally.

## Consequences

- An agent can register a hosted MCP server from a link alone. The first-call approval gate still applies to every tool.
- A remote server sees whatever arguments the agent sends. That is data egress to a URL the model chose, which is the remaining risk once `mcp_manage` is enabled.
- OAuth-protected servers (the MCP auth spec's browser flow) are not supported. Only static headers work, e.g. `Authorization: Bearer ${TOKEN}`. That is a follow-up.
- Server-initiated requests (sampling, elicitation) and resumable streams are not handled. Notifications on a reply stream are skipped.
