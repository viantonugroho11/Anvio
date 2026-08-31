# ADR-0024: Complete the slash-command surface — introspection, session control, per-thread overrides

- **Status:** Accepted
- **Date:** 2026-09-01
- **Related:** #57 (this), #55 (ADR-0023 router shape), #56 (learning-loop lifecycle)

## Context

ADR-0023 defined the `SlashCommandRegistry` port and v2.1.0–v2.1.2 filled in half the workspace nouns (`/agents`, `/skills`, `/souls`, `/goals`, `/mcp`, `/sessions`, `/channels`, `/automations`, plus the learning-loop lifecycle). Issue #57 enumerates the rest: the remaining introspection commands, session control (`/status`, `/stop`, `/history`, `/checkpoint`, `/detach`), per-thread runtime/provider/model overrides, and a uniform mutation surface (`/new`, `/edit`, `/rm`).

The most-requested piece is per-thread overrides: the model provider and runtime are fixed in `spec.model` / `spec.runtime.provider` per agent, so switching either for a single conversation means editing a YAML file. That is the flow this ADR makes safe from chat.

## Decision

Three moves land together in v2.2.0:

1. **`session.metadata` gains three overrides:** `providerOverride`, `modelOverride`, `runtimeOverride`. `RuntimeRoutingAgentRuntime` and `ModelRouter` read the session-level values first and fall back to the agent's `spec.model` / `spec.runtime.provider`. No schema change to agents — the override is per-session, not per-agent, so an override in thread A never leaks into thread B.
2. **All remaining pure-read introspection commands** register through `SlashCommandRegistry.register()`. Ships in v2.2.0.
3. **Session-control commands that only touch session state** (`/status`, `/history`, `/stop`, `/detach`, `/checkpoint`) ship. `/resume` and `/branch` are deferred — they need session-fork primitives (`parent_session_id` chain, resume-from-checkpoint mechanics) that ADR-0025 will design.

### Deferred (ADR-0025)

- **Uniform `/new`, `/edit`, `/rm` mutation surface.** The `/edit` flow described in #57 (post current YAML, next message is an edit prompt scoped to a specialist agent, diff against the file) is a real UX design, not just a command handler. It reuses v2.1.1's diff-mode `/promote` shape, but needs an approver gate for every mutation and a `_trash/` restore path. Big enough to warrant its own ADR.
- **`/resume`, `/branch` session forking.** `parent_session_id` chain design.
- **`/batch`, `/worktree`, `/connections`, `/setup-token`.** Each needs a chat-native UX (QR + polling for setup-token, streaming status for batch) that's out of scope for a router expansion.
- **`/providers add|remove|test`.** Same mutation-surface argument.

### Command surface (v2.2.0)

**Introspection (read-only):**

| Command | Backing |
|---|---|
| `/personas`, `/persona <slug>` | `PersonaService` |
| `/workflows`, `/workflow <slug>` | `WorkflowRegistry` |
| `/blueprints`, `/blueprint <slug>` | `BlueprintCatalogRegistry` |
| `/kanban` | `KanbanEngine.listBoards()` |
| `/tools [--enabled\|--all]` | `ToolGateway.listTools()` + MCP catalog |
| `/hooks` | `workspace/hooks/hooks.yaml` |
| `/providers` | `workspace/providers/routing.yaml` + session override marker |
| `/harness` | `harness.defaults` + effective profile for this thread |
| `/audit [--last 24h\|1000]` | `workspace/audit/tokens.jsonl` tail |
| `/artifacts [--session <id>\|--global]` | `FilesystemArtifactStore.list()` |
| `/knowledge`, `/knowledge <slug>` | `KnowledgeBaseStore` |
| `/skill <slug>` | pair with existing `/skills` — frontmatter + first 2KB |
| `/session <id>` | pair with existing `/sessions` — full status + last N turns |
| `/memory <query>` | filesystem memory + FTS5 (workspace-scoped) |

**Session control:**

| Command | Effect |
|---|---|
| `/status` | active agent, phase, tokens used, pending approvals, override state |
| `/history [n]` | last N turns of this session |
| `/stop` | publish `AGENT_RUN_STOP_REQUESTED` for the active run |
| `/detach` | flip `session.detached = true` |
| `/checkpoint [label]` | persist `agentRunCheckpoint` with an optional label |

**Per-thread overrides (the point of this ADR):**

| Command | Writes | Read by |
|---|---|---|
| `/provider <slug>` | `session.metadata.providerOverride` | `ModelRouter.resolveForSession()` |
| `/model <id>` | `session.metadata.modelOverride` | same |
| `/runtime <slug>` | `session.metadata.runtimeOverride` | `RuntimeRoutingAgentRuntime.resolve()` |
| `/routing` | (read) | dumps effective `{provider, model, runtime}` for the current session, agent's config × overrides |

**Debug / feedback:**

| Command | Effect |
|---|---|
| `/version` | Anvio version, workspace name, git rev, node version |
| `/settings` | effective config for this session (runtime, model, harness, evolution) |
| `/thumbsup`, `/thumbsdown [reason]` | write to `workspace/memory/feedback/<sessionId>.jsonl`, tagged by turn |

### Wiring

- `packages/core/src/types/session.ts` — extend `StoredSession.metadata` typing to advertise the three override fields as first-class (they were `Record<string, unknown>` all along; the fields are now documented and typed for `RuntimeRoutingAgentRuntime` + `ModelRouter` to pick up).
- `packages/platform/src/runtime-routing-agent-runtime.ts` — before consulting `agent.spec.runtime.provider`, check `session.metadata.runtimeOverride` and route the whole factory chain through it. Unknown override → clear error routed back to the user, not a silent fallback.
- `packages/models/src/model-router.ts` — `resolveForSession(session, agent)` returns the effective `{provider, model}` after applying overrides, and is what the local runtime calls.
- `packages/platform/src/slash-commands-extras.ts` grows: every command above registers through the same file. Handlers that need late deps (workflow executor, blueprint catalog, kanban) receive them via `ExtrasOptions`.
- Adapters (Telegram, Discord/Slack when their pickers come online) resync their client-side menu after the extras have registered — for Telegram, `setMyCommands` is idempotent, so calling it again with the fuller list is fine.

### What we deliberately do NOT do

- **No new agent schema fields.** Overrides live on the session so the operator can experiment with a model without editing the file the whole team reads.
- **No leak across sessions.** Override in session A is invisible to session B; the merge happens inside `resolveForSession`, not by mutating the loaded `AgentDefinition`.
- **No "always allow" for mutation.** Every `/new` / `/edit` / `/rm` will require an inline approver in the eventual mutation ADR (0025). Skipping mutation from v2.2.0 rather than shipping it approver-less.

## Consequences

- **Positive:**
  - Per-thread `/provider` / `/model` / `/runtime` is the difference between "edit a YAML file, restart the gateway, re-DM the bot" and "type one message." The wiring already exists in `ModelRouter`; this makes it reachable.
  - The picker on every chat channel shows every read-only workspace noun. The user comparing against Hermes/openclaw sees Anvio at least at parity for discovery.
  - `SlashCommandRegistry.register()` from v2.1.2 is now exercised at scale — every extras command uses it, no factory-side sprawl.

- **Costs:**
  - `slash-commands-extras.ts` becomes big (~15 handlers). If it exceeds ~500 LOC, split into `slash-commands-extras/*.ts` by category (`introspection.ts`, `session.ts`, `overrides.ts`, `debug.ts`) — a mechanical follow-up.
  - `session.metadata` gains three well-known fields; a stale session written before this ADR has `undefined` for all three, which the runtime treats as "no override" (the intended default).

## Alternatives considered

1. **Per-agent override fields in `spec.runtime` / `spec.model`.** Rejected — the whole point is thread-local experimentation. An agent-level field would need to be written back to the file and re-loaded, which is exactly the workflow this ADR removes.
2. **Ship mutation in v2.2.0.** Rejected — the approver flow + `/edit`'s specialist-agent-scoped rewrite needs its own design. See ADR-0025 (to be written).
3. **`/resume` and `/branch` in v2.2.0.** Rejected — session forking needs a `parent_session_id` chain that today doesn't exist. Design belongs in ADR-0025 alongside mutation.
