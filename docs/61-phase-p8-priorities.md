# Phase P8 — MCP stdio, channel E2E, LLM SoulPolicy

**Status:** shipped in v1.13.0  
**Depends on:** P7 (MCP agent runtime)

## Goals

1. **P8a — Real MCP stdio client** replacing stub-only bridge for configured servers.
2. **P8b — Teams/Matrix/Email E2E** inbound webhooks + outbound delivery paths.
3. **P8c — LLM SoulPolicy extraction** from `SOUL.md` with regex fallback + cache.

## P8a — MCP stdio

`McpStdioClient` speaks JSON-RPC over Content-Length-framed stdio per MCP spec:

- `initialize` → `notifications/initialized`
- `tools/list`
- `tools/call`

Configure per server in `mcp/servers.yaml`:

```yaml
spec:
  servers:
    github:
      command: npx
      args: ['-y', '@modelcontextprotocol/server-github']
      transport: stdio   # default; use stub for offline/tests
      enabled: true
```

Set `ANVIO_MCP_STUB=1` to force stub transport globally (CI-friendly).

Mock server for tests: `packages/integrations/scripts/mock-mcp-server.mjs`

## P8b — Channel E2E

| Channel | Inbound | Outbound |
|---------|---------|----------|
| Teams | `POST /api/channels/teams/webhook` Bot Framework activity | OAuth + `conversations/{id}/activities` |
| Matrix | `POST /api/channels/matrix/webhook` `{ roomId, senderId, body }` | Client-Server `send/m.room.message` |
| Email | `handleInboundEmail` | Outbound queue (SMTP wire-up next) |

Harness profiles added for `teams`, `matrix`, `email`.

## P8c — LLM SoulPolicy

When a real model provider is available (and `SOUL_POLICY_LLM` is not `0`), `loadSoulPolicy` uses LLM JSON extraction then `verifyPolicyIds` to drop hallucinated user ids.

Cached by content hash under `workspace/souls/_cache/` (unchanged).

## Remaining (P10+)

See [Phase P9](./62-phase-p9-priorities.md) for completed P8 follow-ups.
