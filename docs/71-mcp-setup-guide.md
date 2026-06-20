# MCP setup guide

How to configure Model Context Protocol servers in an Anvio workspace.

## Quick start

1. Initialize workspace: `anvio init`
2. List presets: `anvio mcp preset list`
3. Apply a preset: `anvio mcp preset apply spotify`
4. Edit `workspace/mcp/servers.yaml` — set `enabled: true` and fill env vars
5. Test: `anvio mcp test spotify`
6. Health: `anvio mcp health`

## servers.yaml structure

```yaml
apiVersion: anvio.io/v1
kind: McpConfig
metadata:
  name: default
spec:
  firstCallApproval: true
  servers:
    spotify:
      command: npx
      args: ['-y', '@modelcontextprotocol/server-spotify']
      transport: stdio
      enabled: true
      env:
        SPOTIFY_CLIENT_ID: ${SPOTIFY_CLIENT_ID}
        SPOTIFY_CLIENT_SECRET: ${SPOTIFY_CLIENT_SECRET}
      allowedTools:
        - search_tracks
        - get_playback_state
```

## Per-server tool allowlist

Set `allowedTools` on a server to expose only named MCP tools to the agent. Omit the field to expose all tools from that server.

Tool names in `allowedTools` are the **MCP tool name** (not the full `anvio_mcp__server__tool` name).

## Presets

Example presets live in `workspace/mcp/presets/`:

| Preset | Purpose |
|--------|---------|
| `spotify` | Spotify playback/search MCP |
| `feishu` | Feishu/Lark document MCP |
| `tinker-atropos` | Tinker Atropos RL MCP |

Presets merge into `mcp/servers.yaml` with `enabled: false` by default.

## First-call approval

When `firstCallApproval: true`, each MCP tool requires human approval once per session (`anvio approve <session> <requestId>`). Approved tools are stored in session metadata.

## Harness MCP-only surface

For channel deployments where the agent should only use MCP + channel output tools:

```yaml
# harness/defaults.yaml
spec:
  toolSurface: mcp_and_channel
  suppressRawOutput: true
```

Built-in gateway tools (`anvio_tools__*`) are hidden; the agent must reply via `anvio_channel__reply` and call MCP tools for actions.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Server disabled` | Set `enabled: true` in servers.yaml |
| Empty tool list | Run `anvio mcp test <id>` — check command and env |
| Tool not visible | Check `allowedTools` filter |
| Stdio timeout | Verify `npx`/binary is on PATH |

See [72-observability-langfuse.md](./72-observability-langfuse.md). Import dashboard: [configs/observability/langfuse-dashboard.json](../configs/observability/langfuse-dashboard.json).
