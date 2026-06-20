# Phase P7 — Gemini native tools + MCP agent runtime

**Status:** shipped in v1.12.0  
**Depends on:** P4/P6 (native tool loops), P5 (harness approval)

## Goals

1. **P7a — Gemini native `functionCall`** for Google Generative Language API.
2. **P7b — MCP tools in agent runtime** — expose enabled MCP servers as `anvio_mcp__{server}__{tool}`.
3. **P7c — MCP first-call approval gate** — first use per session/tool requires human approval (reuses harness approval flow).

## P7a — Gemini native tools

When `GeminiProvider.supportsNativeTools` is true, the agent runtime sends `functionDeclarations` and handles `functionCall` / `functionResponse` parts.

Implementation:

- `packages/models/src/providers/gemini-messages.ts`
- `packages/models/src/providers/gemini.provider.ts`

## P7b — MCP tool port

Enabled MCP servers from `mcp/servers.yaml` are cataloged at platform boot:

```
anvio_mcp__github__search_code
anvio_mcp__github__create_issue
```

`McpToolPort` wraps the harness/builtin tool port and delegates MCP-prefixed calls to `McpBridge`.

## P7c — First-call approval

Configure in `mcp/servers.yaml`:

```yaml
spec:
  firstCallApproval: true   # default
  servers:
    github:
      enabled: true
      command: npx
      args: ['-y', '@modelcontextprotocol/server-github']
```

Flow:

1. Agent calls MCP tool → `pending_approval` if not yet approved for session
2. Worker publishes `APPROVAL_REQUESTED` (same as harness)
3. Human approves on any channel → `mcpApprovedTools` persisted in session metadata
4. Agent run resumes; subsequent calls to same server/tool proceed without re-approval

Disable gate: `firstCallApproval: false`

## Remaining (P8+)

- Real MCP stdio client (replace stub bridge)
- Channel E2E Teams/Matrix/Email
- LLM SoulData extraction
