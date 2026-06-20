# Phase P12 — Integration polish & slaude UX

**Status:** in progress  
**Depends on:** v1.17.0 (P11 — 71 gateway tools)

## Goals

Close operational gaps post tool-breadth: MCP presets live, harness slaude parity, Signal bridge, observability docs.

## P12 deliverables

| Track | ID | Deliverable | Status |
|-------|-----|-------------|--------|
| MCP | P12-M1 | `allowedTools` per MCP server + catalog filter | |
| MCP | P12-M2 | `anvio mcp preset list\|apply` | |
| MCP | P12-M3 | Integration tests for presets + mock MCP | |
| MCP | P12-M4 | [71-mcp-setup-guide.md](./71-mcp-setup-guide.md) | |
| slaude | P12-SL1 | Harness `toolSurface: mcp_and_channel` | |
| slaude | P12-SL2 | `anvio session 1on1` dedicated flow | |
| slaude | P12-SL3 | Export `anvio_channel__set_status` in harness tool defs | |
| Channel | P12-CH1 | Signal signal-cli REST outbound | |
| Obs | P12-O1 | [72-observability-langfuse.md](./72-observability-langfuse.md) | |

## Out of scope (P13+)

- Google Chat service account
- SSH / Daytona / Modal
- Streaming STT
- Full browser CDP grant

See [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md).
