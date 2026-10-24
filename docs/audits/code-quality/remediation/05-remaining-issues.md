# 05 — Remaining Issues, Blockers and Accepted Risks

## Blocked (need a decision or a dedicated change)

| ID | Item | Why blocked | Required action |
|---|---|---|---|
| CQ-016 (part) | `zod` 3.25.76 high advisory (GHSA-mrhx-c7xc-m3w5) in `@anvio/core`, `knowledge`, `tool-bus` | Fixed only in zod 4. Zod 4 changes `.default()` (no longer parses the default through the schema) — `@anvio/core` relies on `.default({})` to fill nested defaults in nearly every schema, so the upgrade is a behaviour-changing migration, not a bump | Migrate core schemas to zod 4 (`.prefault()` where nested defaults matter) with characterization tests over every config fixture; then raise CI audit level to `high` |
| CQ-017 (part) | Prettier: 383 files non-compliant | A repo-wide reformat in this change would bury the remediation diff | One formatting-only commit, then add `pnpm format:check` to CI |

## Needs approval (contract changes I did not make)

| Item | Current | Proposal | Impact |
|---|---|---|---|
| `http_request` default | enabled | disabled in `DEFAULT_TOOL_GATEWAY_YAML` and schema default | workspaces relying on the default must opt in |
| `engines.node` | `>=20.0.0` | `>=22.0.0` | Node 20 is EOL; Slack/Discord adapters need the global WebSocket (unflagged from Node 22); CI already runs 22/24 |
| Approval for mutating builtin tools | enforced only when the model calls `request_approval` | wire `tool-bus` `requireApproval` into `ToolGateway.call` | agents that mutate without asking would start pausing |
| Daemon start without model credentials | warns, uses mock | refuse unless `ANVIO_ALLOW_MOCK=1` | breaks "try it without a key" onboarding |

## Accepted risks (documented, not fixed)

| Risk | Why accepted for now | Mitigation in place |
|---|---|---|
| Host-runtime sandbox (shell/python/node/go) has network access even with `networkEnabled: false` | real isolation needs namespaces/containers; docker runtime already isolates | secrets no longer inherited; option documented; use `runtime: docker` for untrusted code |
| DNS rebinding between egress check and connect | closing it needs a pinned-IP dispatcher (undici `Agent` with custom `lookup`) — new dependency | private ranges blocked on the resolved address; documented in `egress.ts` |
| Browser tools: only the first URL is egress-checked | Playwright loads sub-resources and redirects itself | browser tools disabled by default |
| A tool that ignores `ctx.signal` keeps running after stop | tools are third-party/MCP code | the run itself ends immediately; network builtins honour the signal |
| Vendor runtimes (Claude Code, Cursor, Codex, Antigravity) are not stoppable via `stop()` | they run their own loops in vendor CLIs | unchanged from before |

## Partially fixed — follow-up work

| ID | What remains |
|---|---|
| CQ-002 | default-off decision above; optional approval for non-GET `http_request` |
| CQ-003 | network isolation for host runtimes |
| CQ-008 | verify Slack `apps.connections.open` flow and Discord RESUME against live sandboxes |
| CQ-011 | split `registerPlatformExtras` (~1 280 lines) by domain; route CLI command modules through platform factories instead of building subsystems |
| CQ-012 | 133 bare `catch {` blocks remain; next: `integrations`, `learning`, `runtimes`, `workspace` |
| CQ-018 | spans for model call / tool call / channel send; migrate remaining 400 `console.*` calls to `createLogger`; then `no-console` lint rule |
| CQ-021 | make `getContext` long-term loading lazy or bounded |
| CQ-024 | wire or remove `tool-bus` |
| CQ-026 | central runtime-defaults module, expose iteration cap/TTLs in agent spec |
| CQ-028 | tests for `hooks`, `workflows`, `batch`, `kanban`, `blueprints`, `goals`, `acp`; add `@vitest/coverage-v8` (new dev dependency) |
| CQ-029 | engines bump (approval above) |
| — | Telegram `getUpdates` long-poll is not aborted on `stop()` (shutdown waits up to the 25 s poll or the 10 s shutdown cap) |
| — | Tool argument validation against the advertised JSON schema (audit 04 §6) not implemented |

## Not verified

| ID | Gap |
|---|---|
| CQ-008 | live Slack/Discord |
| CQ-007 | NATS (Level 3) event bus mode |
| all | Node 22 runtime locally; Docker sandbox path; Postgres tier |
