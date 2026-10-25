# ADR 0006: MCP Architecture

## Decision
Official MCP SDK + registry pattern.

## Rationale
Standard protocol, decoupled tool integration.

## Reconciliation note (2026-10-25)

Status was not recorded; treated as **Accepted**. The registry pattern is implemented (`packages/integrations`). The client is **not** built on the official MCP SDK: it is an in-house stdio/HTTP client. Its stdio framing was incompatible with official servers until PR #118. The de facto design is recorded in [ADR-0039](0039-in-house-mcp-client.md) (Proposed). This ADR's status is unchanged until ADR-0039 is decided. Original decision text above is unchanged.
