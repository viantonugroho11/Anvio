# Phase P11d — Platform integrations & Hermes niche tools

**Status:** shipped (unreleased)  
**Depends on:** P11c (57 tools baseline)

## Goals

Close remaining Hermes **hermes-cli** gaps: **57 → 71 built-in gateway tools** (~100% breadth by count).

## P11d-T1 — New tools (14)

| Category | Tools |
|----------|-------|
| Home Assistant | `ha_list_entities`, `ha_get_state`, `ha_list_services`, `ha_call_service` |
| Multi-agent | `mixture_of_agents` |
| Search / media | `x_search`, `video_analyze`, `video_generate` |
| Platform | `computer_use`, `discord_admin`, `spotify_search`, `feishu_doc_read` |
| Skills / RL | `skill_manage`, `rl_tool` (action covers all `rl_*` ops) |

## MCP presets

`workspace/mcp/presets/` — Spotify, Feishu, Tinker-Atropos examples. Gateway tools delegate via `callMcpTool` when MCP servers enabled.

## Env vars

| Tool | Env |
|------|-----|
| `ha_*` | `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN` |
| `x_search` | `X_BEARER_TOKEN` or `WEB_SEARCH_API_KEY` |
| `discord_admin` | `DISCORD_BOT_TOKEN` |
| `spotify_search` | `SPOTIFY_ACCESS_TOKEN` or MCP spotify |

## Remaining (MCP-only sub-tools)

Extra Spotify/Feishu/Yuanbao/RL individual keys remain on MCP servers — not duplicated as 71 separate gateway keys.

See [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md).
