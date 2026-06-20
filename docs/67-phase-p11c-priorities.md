# Phase P11c — Hermes depth tools

**Status:** shipped (unreleased)  
**Depends on:** P11b (42 tools baseline)

## Goals

Expand gateway from **42 → 57 tools**: full kanban agent API, browser depth, OS orchestration as gateway tools.

## P11c-T1 — New tools (15)

| Category | Tools |
|----------|-------|
| Kanban | `kanban_block`, `kanban_unblock`, `kanban_heartbeat`, `kanban_comment`, `kanban_link`, `kanban_complete` |
| Browser | `browser_get_images`, `browser_vision`, `browser_dialog`, `browser_cdp` |
| Orchestration | `delegate_task`, `cronjob`, `skills_list`, `skill_view`, `send_message` |

## Platform wiring

- `listSkills` / `getSkill` — workspace loader at gateway load
- `delegateTask`, `manageCronjob`, `sendMessage` — via `toolGateway.mergeContext()` after runtime/automation start
- `agentId` passed per tool call for kanban block/unblock/heartbeat

## Remaining Hermes gaps (MCP / niche)

RL (`rl_*`), Home Assistant, Spotify, Feishu, Yuanbao, Discord admin, `mixture_of_agents`, `x_search`, `video_*`, `computer_use`, full raw CDP grant.

See [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md).
