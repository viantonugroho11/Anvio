# ADR-0039: In-house MCP client conforming to the MCP transports

- **Status:** Proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0006](0006-mcp-architecture.md) ("Official MCP SDK + registry pattern"), [ADR-0036](0036-agent-managed-skills-and-mcp-servers.md), [ADR-0037](0037-remote-mcp-servers-over-http.md), audit phase 3 finding G-33, post-refactoring fix PR-02

## Context

[ADR-0006](0006-mcp-architecture.md) decided on "Official MCP SDK + registry pattern". The registry pattern was implemented (`packages/integrations/src/integration-registry.ts`). The client side was not built on the official SDK:

- `packages/integrations/src/mcp-stdio-client.ts` and `mcp-http-client.ts` are hand-written JSON-RPC clients.
- `@modelcontextprotocol/sdk` is a dependency only of `packages/runtimes` (vendor-runtime integration), not of `packages/integrations`.

Being hand-written caused a real defect. The stdio client used `Content-Length` framing, while the MCP stdio transport is newline-delimited JSON. As a result, no official-SDK server could initialize (audit phase 3 G-33). PR #118 (PR-02) fixed the framing and added an E2E test against a server built with the official SDK (`tests/integration/e2e/mcp-approval.e2e.integration.spec.ts`, MCP-01..05).

This ADR records the de facto decision so that ADR-0006 does not describe the code incorrectly. It is **Proposed**: the code matches it, but the owners have not decided whether to keep the in-house client or migrate to the SDK client.

## Decision (proposed)

1. Keep the in-house stdio and HTTP clients.
2. Conformance is defined by the MCP transport specification, not by the SDK. Two things guard it:
   - NDJSON framing, with `Content-Length` frames still accepted for older servers;
   - the official-SDK E2E fixture.
3. Any future migration to `@modelcontextprotocol/sdk` client classes must keep the `McpBridge` surface (`listTools`, `callTool`, `close`, `invalidate`) unchanged.

## Consequences

- Protocol drift (new MCP spec revisions) must be tracked manually, so the E2E fixture is the regression guard.
- ADR-0006 receives a reconciliation note pointing here. Its status is not changed until this ADR is accepted or rejected.

## Alternatives

- **Migrate to the SDK client now.** Larger change; fixes drift risk structurally. Not chosen in a documentation-only phase.
