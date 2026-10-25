# ADR-0038: Position Anvio as an extensible multi-agent platform; keep local-by-default deployment

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Repository owner (stated in the Phase 5 documentation directive)
- **Amends:** [ADR-0007](0007-local-first-architecture.md). Only its product positioning changes; its technical defaults stay in force.
- **Related:** [ADR-0026](0026-a2a-protocol-integration.md)–[ADR-0031](0031-a2a-authentication.md) (A2A), [ADR-0009](0009-runtime-oauth-authentication.md) (vendor runtimes), [ADR-0036](0036-agent-managed-skills-and-mcp-servers.md) / [ADR-0037](0037-remote-mcp-servers-over-http.md) (MCP)

## Context

[ADR-0007](0007-local-first-architecture.md) (accepted) framed Anvio as a "Local-First, File-First, CLI-First" agent operating system. That framing was accurate when the project was a single-process assistant. Since then, the code has gained capabilities that the label does not describe:

- **Managing other agents.**
  - `delegate_task` and `mixture_of_agents` run workspace agents as sub-agents (`packages/platform`).
  - A2A has a server, which publishes Agent Cards and exposes workspace agents over JSON-RPC (`packages/a2a/src/server`).
  - A2A also has a client and an `a2a_delegate` tool, which delegates to external A2A agents (`packages/a2a/src/client`).
- **Running vendor agents as runtimes.** Claude Code, Cursor, Codex and Antigravity run behind one `RuntimeProvider` port with per-agent fallback chains (`packages/runtimes`).
- **Connecting to external tool servers.** MCP is supported over stdio and HTTP (`packages/integrations`).
- **A shared runtime behind many channels**, through the channel hub and the unified gateway (`packages/channels`, `packages/platform/src/unified-gateway.ts`).

Calling this a "local-first assistant" undersells the orchestration role and suggests limits the code does not have. At the same time, the defaults that ADR-0007 chose still hold and remain valuable:

- filesystem storage;
- auth off with a loopback bind;
- an in-process event bus;
- no Docker requirement.

These defaults were verified on 2026-10-25: `anvio init` followed by `anvio run` works with no services and no API key, using the mock provider.

## Decision

1. **Positioning.** Anvio is described as an _extensible AI agent platform_. It runs, manages and orchestrates its own agents, delegates to external agents (A2A, vendor runtimes), and connects them to models, tools (MCP), skills, memory and channels. "Local-first" is no longer the headline.
2. **Deployment default kept.** Local, file-based, single-process operation stays the **default deployment mode**. Progressive tiers (Level 1 filesystem → Level 2 SQLite → Level 3+ PostgreSQL/NATS) are unchanged.
3. **No plugin claim.** Public documentation must not describe a "plugin architecture" until one exists. Phase 3 audit doc 03 found no plugin manager, registry, manifest or lifecycle. The extension mechanisms are skills, MCP servers, event hooks, blueprints and OpenAI-compatible provider endpoints.

## Consequences

- The root README, `docs/02-architecture.md` and `docs/README.md` use the new positioning.
- `docs/01-vision.md` (local-first vision, plugin claim) is detached to `docs/_detached/obsolete-docs/`.
- ADR-0007 stays **Accepted** for its technical decisions. A reconciliation note points here for positioning.
- **Follow-up (code, not done by this ADR):** user-facing strings still say "Local-First AI Agent Operating System". These are the CLI help banner (`apps/cli/src/main.ts`) and the package descriptions. Changing them is a separate, user-visible change.

## Alternatives considered

- **Keep "local-first" as the headline.** Rejected: it hides the multi-agent and external-agent capabilities and is the main source of misleading positioning in older docs.
- **Drop local-by-default operation.** Rejected: there is no evidence it is unwanted, and it is the zero-setup path that the quick start relies on.
