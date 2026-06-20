# Phase P11b — Hermes tool parity expansion

**Status:** shipped (v1.17.0)  
**Depends on:** P11a (21 tools baseline)

## Goals

Expand Anvio built-in gateway from **21 → 42 tools** to cover core Hermes toolsets.

## P11b-T1 — New tools (21)

| Category | Tools |
|----------|-------|
| Web | `web_extract` |
| File | `patch_file`, `search_files` |
| Browser session | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_console` |
| Terminal | `terminal`, `process` |
| Agent | `todo`, `clarify`, `session_search` |
| Vision | `vision_analyze` |
| Kanban | `kanban_list`, `kanban_show`, `kanban_create`, `kanban_move` |

## Platform wiring

- `sessionId` passed to browser/todo tools per agent run
- `searchSessions` — keyword search over workspace session messages
- `kanban` — `@anvio/kanban` engine for kanban_* tools

## Hermes gaps remaining (via MCP or future)

- `delegate_task`, `cronjob`, `mixture_of_agents`, `x_search`, `video_*`, RL (`rl_*`), Home Assistant, Spotify, Feishu, Discord admin, `computer_use`, `browser_cdp`

See [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md).

## Enable browser tools

```bash
pnpm add playwright -w
# workspace/tools/gateway.yaml — enable browser_navigate, browser_snapshot, ...
```
