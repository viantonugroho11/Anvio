# 03 — Architecture & Maintainability

Evidence base: dependency graph computed from all workspace `package.json` files (no cycles found), import scans, and reads listed in `02`. Findings referenced by ID from `09-findings-register.md`.

## 1. Coupling and cohesion

**What works**
- `core` is a true leaf (0 internal deps, fan-in 36). Ports (`ModelProvider`, `RuntimeToolPort`, `MemoryStore`, `SessionStore`, `StorageProvider`, `ChannelAdapter`) let `agents` depend on interfaces rather than adapters. `DefaultAgentRuntime` receives everything through `AgentRuntimeDeps` — the runtime is constructible in tests with scripted providers (see `models/src/scripted-provider.ts`, `agents/src/runtime-*.spec.ts`).
- Tool ports compose by decoration (`ComposableSkillRegistry → McpToolPort → HarnessAwareToolPort → ToolGateway`), which keeps each concern (skills, MCP approval, channel tools, builtins) in its own package.
- Provider-specific error mapping lives at the adapter (`models/src/provider-error.ts`), and the fallback chain consumes the normalized `retryable` flag (`fallback-chain.ts:72-76`). Good separation.

**What does not**
- **Composition root is a monolith.** `createPlatform` (CQ-011) wires 20+ subsystems and also contains business behaviour: session-completed handler (token audit + learning + in-channel draft prompt, `index.ts:~940-1000`), learning-soul resolution (`:365-380`), A2A boot. Business logic in the composition root means behaviour changes require touching wiring.
- **CLI bypasses the root.** `apps/cli` depends on 27 packages directly and builds subsystems itself (e.g. credentials, ssh/singularity runtimes at `main.ts:1546-1573`). Two assembly paths means a fix in `createPlatform` (e.g. a new safety default) does not reach CLI commands that self-assemble.
- **Event bus as synchronous call stack.** The local bus awaits subscribers inline (`local-event-bus.ts:60-70`), so "publish an event" is actually "run the entire agent turn before returning" (CQ-007). The design reads as decoupled but behaves as tightly coupled, with failure isolation only through per-handler try/catch.
- **Optional subsystems leak into core packages:** `tools → voice`, `channels → voice`, `tools → db` (CQ-024).

## 2. Responsibility boundaries

| Concern | Owner today | Issue |
|---|---|---|
| Session history state | `memory` short-term **and** `workspace` session store (`StoredSession.messages`) **and** runtime checkpoint in `session.state.metadata` | Three representations of "the conversation"; the runtime writes memory, the worker writes session status, learning reads `stored.messages`. Unclear which is authoritative → CQ-004/021 classes of bugs. |
| Approval | harness gate (channel), MCP first-use (integrations), runtime checkpoint (agents), `PendingMutationStore` (platform, slash commands), `tool-bus.requireApproval` (dead) | Five mechanisms; none enforce approval for builtin mutating tools — enforcement relies on the system prompt asking the model to call `request_approval` (`harness/src/runtime-tool-port.ts:62`). |
| Progress reporting | runtime yield **and** `onProgress` callback | Duplicate (CQ-020). |
| Provider selection | runtime (`explicitRoute`), router (`routing.yaml`), registry (`resolveForAgent`), platform default (`modelProvider`) | Platform default is then used for accounting (CQ-019). |
| Cancellation | runtime `stopRequests` Set | No ownership of in-flight I/O (CQ-006). |

## 3. Circular dependencies

None at package level (verified by DFS over the workspace graph). File-level cycles were not analysed (no madge/dpdm installed; installing new deps was out of scope) — **NOT VERIFIED**.

## 4. Abstraction quality

- **Justified abstractions:** ports in `core`; tool-port decorators; `BaseChannelAdapter` (shared stream buffering, typing keep-alive, guarded dispatch — `base-channel-adapter.ts:63-207`); `walkFallbackChain` + breaker.
- **Premature / dead abstractions:** `tool-bus` policy layer (unused); `OAuth2AuthProvider` that throws on every call (`auth/src/index.ts:59-70`) yet is selectable in config; `StubToolExecutor` ("not implemented in Phase 1"); `apps/desktop` (README only). Each adds surface area a maintainer must understand and that docs may describe as real.
- **Missing abstraction where it would pay off:** a single `resolveInside(root, rel)` (CQ-013), a single `executeToolRound` (CQ-025), a keyed per-session queue (CQ-007), a `gracefulShutdown` helper (CQ-015). These are small helpers, not new layers.

## 5. God modules / modules with too many responsibilities

1. `apps/cli/src/main.ts` — 2 883 lines, 42 commands, 27 package imports.
2. `packages/platform/src/index.ts` — `createPlatform` ~810 lines; also mock provider, gbrain options, re-exports.
3. `packages/platform/src/slash-commands-extras.ts` — 1 280-line registration function.
4. `packages/tools/src/builtins/index.ts` — 891-line `switch` over ~70 tools with repeated result mapping.
5. `packages/agents/src/runtime.ts` — `stream` generator (~290 lines) carrying most agent-loop defects.

## 6. Components difficult to test independently

- Platform event handlers (closures inside `createPlatform`) — only testable by booting a whole platform; integration tests do exactly that (`tests/integration/boot.integration.spec.ts`).
- Slash commands in `registerPlatformExtras` — same.
- Channel adapters create `WebSocket` and timers internally (`discord.ts:165`, `slack.ts:190`) with no injection seam, which is why stop/reconnect behaviour has no tests (CQ-008).
- `ToolGateway.load` reads the file system directly; tests must write `tools/gateway.yaml` to disk.

## 7. Extensibility

- **Adding a model provider:** good — implement `ModelProvider`, register in `provider-catalog.ts`/`provider-factory.ts`; runtime unchanged. Error normalization contract is documented.
- **Adding a tool:** medium — add schema (`tool-schemas.ts`, 474 lines), description, default YAML entry, gateway schema entry (`core/src/schemas/tool-gateway.schema.ts`), and a `case` in the builtin switch: 5 files edited per tool, with no type link forcing consistency between them.
- **Adding a channel:** medium — subclass `BaseChannelAdapter`, add to `create-channels.ts` (529 lines). Reconnect/backoff must be re-implemented per adapter (currently inconsistent).
- **Adding a CLI command:** poor — edit the 2 883-line file.

## 8. Recommended architecture improvements (only where a defect demonstrates the need)

| # | Change | Driven by | Size |
|---|---|---|---|
| A1 | Extract platform event handlers and slash-command groups into named modules with explicit deps (move verbatim first, then test) | CQ-011, untestable closures | L (incremental) |
| A2 | Route CLI commands through platform factories; split `main.ts` into `commands/*` | CQ-011, divergent assembly | L |
| A3 | Make inbound → run asynchronous with a per-session serial queue in the gateway worker | CQ-007 | M–L |
| A4 | Declare one authoritative conversation store per session (memory short-term) and treat `StoredSession.messages` as a projection | CQ-004, CQ-021 | M |
| A5 | Enforce approval/egress policy in `ToolGateway.call` (reuse `tool-bus` schema rather than writing a new one) | CQ-002, CQ-024 | M |
| A6 | Per-run `AbortController` owned by the runtime | CQ-006 | M |
| A7 | Single source of truth for a tool definition (schema + description + default + handler in one object) | Extensibility §7 | M |

Explicitly **not** recommended: introducing DDD/hexagonal layering, DI containers or a plugin framework rewrite — the existing port/adapter split is adequate; the problems are concentrated, concrete and fixable in place.
