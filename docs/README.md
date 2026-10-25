# Anvio documentation

This index is the entry point to the **active** documentation. Everything linked here is current or explicitly marked as reference material.

When documentation and code disagree, **the code is the source of truth**. Please report the mismatch, or fix the document.

Historical material (old release plans, superseded gap registers, the previous README) lives in [`_detached/`](_detached/README.md). It is not part of this navigation and must not be used as a description of the current system.

Document numbers (`NN-*.md`) are stable identifiers that code, ADRs and other documents link to. They do not imply reading order or recency. Entries marked _brief_ are short overviews; use the linked deeper documents or the code for details.

## Getting started

| Document                                                | Purpose                               |
| ------------------------------------------------------- | ------------------------------------- |
| [README — Quick Start](../README.md#quick-start)        | Install, create a first agent, run it |
| [21 — Development guide](21-development-guide.md)       | Build, test and local development     |
| [71 — MCP setup guide](71-mcp-setup-guide.md)           | Connect an MCP server                 |
| [20 — Troubleshooting](20-troubleshooting.md) _(brief)_ | Common problems                       |
| [19 — Runbooks](19-runbooks.md) _(brief)_               | Operational procedures                |

## Architecture

| Document                                                                                                      | Purpose                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [02 — Architecture](02-architecture.md)                                                                       | **System overview**: components, dependency rule, request flow, tiers   |
| [03 — Agent runtime](03-runtime.md)                                                                           | Tool loop and run lifecycle                                             |
| [24 — Advanced Agent OS overview](24-advanced-agent-os-overview.md)                                           | Map of the souls, goals, automation, kanban, batch and hooks subsystems |
| [35 — Workspace architecture](35-workspace-architecture.md)                                                   | Workspace layout, loaders, session stores                               |
| [38 — Integration architecture](38-integration-architecture.md)                                               | MCP-first integration registry                                          |
| [17 — Event flows](17-event-flows.md) _(brief)_ · [18 — Sequence diagrams](18-sequence-diagrams.md) _(brief)_ | Event bus subjects and flows                                            |

## Agent management and orchestration

| Document                                                                                                                                        | Purpose                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [04 — Personas](04-personas.md) _(brief)_ · [25 — Soul system](25-soul-system.md) · [42 — Soul gate](42-soul-gate.md)                           | Agent identity, policy and evolution                                                                    |
| [40 — Subagent delegation](40-subagent-delegation.md)                                                                                           | `delegate_task`, `mixture_of_agents`, depth limits                                                      |
| [30 — Runtime providers & code execution](30-runtime-providers.md) · [47 — Remote runtimes](47-remote-runtimes.md)                              | `local`, vendor CLIs (Claude Code, Cursor, Codex, Antigravity), ssh, docker, singularity, daytona/modal |
| [26 — Goal system](26-goal-system.md) · [28 — Kanban](28-kanban-system.md) · [32 — Batch](32-batch-processing.md)                               | Planning and multi-agent coordination                                                                   |
| [27 — Automation engine](27-automation-engine.md) · [31 — Event hooks](31-event-hooks.md)                                                       | Scheduling (cron, IANA timezones) and event-driven actions                                              |
| [11 — Workflows](11-workflows.md) _(brief)_ · [45 — Workflow engine](45-workflow-engine.md) · [34 — Blueprint catalog](34-blueprint-catalog.md) | DAG workflows and templates                                                                             |

## Agent-to-agent and editor protocols

| Document                                                  | Purpose                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| [78 — A2A protocol](78-a2a-protocol.md)                   | A2A server, Agent Cards, client delegation, auth; current gaps |
| [39 — Editor integration (ACP)](39-editor-integration.md) | `anvio acp serve` editor bridge                                |

## Tools and MCP

| Document                                                                             | Purpose                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| [44 — Tool gateway](44-tool-gateway.md) · [08 — Tool runtime](08-tools.md) _(brief)_ | Built-in tools, allow-list, egress policy     |
| [07 — MCP architecture](07-mcp.md)                                                   | MCP client (stdio, HTTP), approval, lifecycle |

## Models

| Document                                                                                             | Purpose                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [09 — Model router](09-model-router.md) · [36 — Provider routing & fallback](36-provider-routing.md) | Provider selection, fallback chains, circuit breakers, budgets |
| [33 — Credential pools](33-credential-pools.md)                                                      | Encrypted key pools                                            |

## Skills and extension

| Document                                                                                                                                                                                                   | Purpose                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [05 — Skills](05-skills.md) · [37 — Skills catalog](37-skills-catalog.md) · [77 — Skill execution engine](77-skill-execution-engine.md) · [74 — Workflow → skill example](74-workflow-to-skill-example.md) | Prose and composable skills, catalog, install and upgrade                                                                                                                                                                                                                                      |
| **Plugins**                                                                                                                                                                                                | Anvio has **no plugin system** (no manager, manifest or registry). Extension points are skills, MCP servers, event hooks, blueprints and OpenAI-compatible provider endpoints. See [ROADMAP T-058](ROADMAP.md#p2-and-below) and [ADR-0038](adr/0038-extensible-agent-platform-positioning.md). |

## Memory and learning

| Document                                                                                   | Purpose                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [06 — Memory architecture](06-memory.md) · [29 — Memory providers](29-memory-providers.md) | Short- and long-term memory; filesystem, sqlite, honcho, gbrain |
| [43 — Learning loop](43-learning-loop.md)                                                  | Session summaries, memory nudges, skill drafts                  |
| [49 — Workspace artifacts](49-workspace-artifacts.md)                                      | Markdown-first artifacts                                        |

## Channels

| Document                                                                            | Purpose                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [10 — Channels](10-channels.md) · [46 — Expanded channels](46-expanded-channels.md) | Channel hub and adapters                             |
| [41 — Channel harness](41-channel-harness.md)                                       | Engagement, formatting, approvals                    |
| [76 — Unified gateway](76-unified-gateway.md)                                       | One daemon: channels + worker + HTTP API + WebSocket |
| [48 — Voice mode](48-voice-mode.md)                                                 | STT/TTS                                              |

## Security, operations and reference

| Document                                                                                                      | Purpose                                            |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [12 — Security](12-security.md)                                                                               | Auth layers, network exposure, sandboxing, secrets |
| [13 — Observability](13-observability.md) · [72 — Langfuse + OpenTelemetry](72-observability-langfuse.md)     | Logs, metrics, traces                              |
| [14 — Deployment](14-deployment.md) _(brief)_                                                                 | Supported deployment modes                         |
| [15 — API reference](15-api-reference.md) _(brief)_ · [16 — Database schema](16-database-schema.md) _(brief)_ | Reference                                          |
| [22 — Contributing](22-contributing.md) _(brief)_                                                             | Contribution workflow                              |

## Decisions, plans and audits

| Document                                                                                                                                          | Purpose                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [ROADMAP.md](ROADMAP.md)                                                                                                                          | **Canonical roadmap**: open gaps, priorities, owner decisions     |
| [adr/README.md](adr/README.md)                                                                                                                    | ADR index with reconciled status                                  |
| [plans/README.md](plans/README.md)                                                                                                                | Active plans (vNext plan of record)                               |
| [audit/](audit/00-executive-summary.md)                                                                                                           | Architecture audits, phases 1–4 (open findings feed the roadmap)  |
| [audits/code-quality/](audits/code-quality/00-executive-summary.md) · [audits/post-refactoring/](audits/post-refactoring/00-executive-summary.md) | Code-quality audit and remediation; post-refactoring verification |
| [documentation-maintenance-report.md](documentation-maintenance-report.md)                                                                        | What changed in the 2026-10-25 documentation reconciliation       |
| [CHANGELOG](../CHANGELOG.md)                                                                                                                      | Release history                                                   |
