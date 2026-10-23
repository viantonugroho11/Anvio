# 10 — Refactoring Roadmap

Ordering is by risk reduction per unit of effort, respecting dependencies. Effort: S (≤1 day), M (2–4 days), L (1–2 weeks), XL (>2 weeks). No calendar dates. Every task preserves external behaviour unless the behaviour is the defect.

## P0 — Immediate (security / production-critical)

### P0-1 Fail fast on missing JWT secret
- **Findings:** CQ-001 · **Files:** `packages/auth/src/index.ts`
- **Change:** throw `AnvioError('CONFIG_ERROR')` when `provider: jwt` and `JWT_SECRET` missing/short; pin `algorithms: ['HS256']`.
- **Deps:** none · **Effort:** S · **Risk:** LOW (breaks only insecure setups — note in CHANGELOG)
- **Acceptance:** platform boot with `auth.enabled: true, provider: jwt` and no secret exits non-zero with a clear message; `dev-secret` string removed from source.
- **Tests:** new `packages/auth/src/index.spec.ts` (missing secret, forged `dev-secret` token, valid token, `alg: none` token).
- **Benefit:** closes auth bypass.

### P0-2 Egress policy for network tools
- **Findings:** CQ-002 (+ CQ-012 gateway.yaml fail-open)
- **Files:** `packages/tools/src/builtins/network-tools.ts`, `web-fetch.ts`, `packages/tools/src/gateway.ts`, `packages/core/src/schemas/tool-gateway.schema.ts`
- **Change:** default `http_request.enabled=false` (both YAML and zod default); shared `assertEgressAllowed(url, policy)` (http/https only; resolve host; block loopback, link-local, RFC1918, ULA unless in `spec.network.allowHosts`); stream response with byte cap; make `ToolGateway.load` fail on parse/validation error (keep default only on `ENOENT`).
- **Deps:** none · **Effort:** M · **Risk:** MEDIUM (workspaces relying on default `http_request`)
- **Acceptance:** requests to `127.0.0.1`, `169.254.169.254`, `localhost`, `[::1]` rejected by default; 10 MB response capped without full buffering; malformed gateway.yaml aborts boot naming the file.
- **Tests:** unit tests per blocked range + DNS-resolving hostname; integration `phase-h` extended with malformed YAML.

### P0-3 Harden code execution and skill conditions
- **Findings:** CQ-003, CQ-033, CQ-034
- **Files:** `packages/execution/src/sandbox/process-sandbox.ts`, `packages/tools/src/builtins/index.ts`, `packages/tools/src/gateway.ts` (export), `packages/skills/src/executor.ts`
- **Change:** env allowlist + explicit `options.env`; `detached:true` + kill process group; cap stdout/stderr; refuse `networkEnabled:false` in process mode (or route to docker); delete in-process `executeCode` fallback; replace `new Function` conditions with a restricted evaluator and validate conditions at skill load/validate time.
- **Deps:** none · **Effort:** M · **Risk:** MEDIUM (skills using undocumented expression syntax)
- **Acceptance:** sandboxed `env` shows no `*_API_KEY`/`JWT_SECRET`/`ANVIO_CREDENTIALS_PASSPHRASE`; a condition referencing `process` fails validation; `execute_code` without executor returns `failed`.
- **Tests:** sandbox env test, timeout kills grandchild, output cap; evaluator unit tests; run `anvio skill validate` across `workspace/skills` and bundled catalog.

### P0-4 Patch vulnerable dependencies
- **Findings:** CQ-016 · **Files:** `apps/web/package.json`, `packages/integrations|runtimes|platform/package.json` (MCP SDK, `@a2a-js/sdk`), `apps/api/package.json` (NestJS), root `pnpm.overrides`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`
- **Change:** `next ≥15.5.28`; `@modelcontextprotocol/sdk ≥1.32.0`; bump `@a2a-js/sdk` or override `proxy-addr ≥2.0.8`; `multer ≥2.3.0`; `brace-expansion ≥5.0.11`; `source-map-js ≥1.2.2`; `zod ≥4.6.6` (and plan removal of zod 3); add `pnpm audit --prod --audit-level=high` job.
- **Deps:** none (requires approval to change lockfile) · **Effort:** S–M · **Risk:** MEDIUM (Next/MCP minor-version behaviour)
- **Acceptance:** `pnpm audit --prod` reports 0 critical / 0 high; full build + 800 tests green.
- **Tests:** existing suite; MCP integration specs (`phase-p7-mcp-gemini`, `integrations`).

## P1 — High priority (reliability & agent-core maintainability)

### P1-1 Unify tool rounds and fix approval checkpoint
- **Findings:** CQ-004, CQ-025, CQ-023
- **Files:** `packages/agents/src/{runtime,tool-loop,native-tool-loop,run-checkpoint}.ts`
- **Change:** single `executeToolRound`; checkpoint includes assistant turn + completed tool results + synthetic "not executed" results for skipped calls; zod-validated, versioned checkpoint.
- **Deps:** none (do before P1-2 to avoid conflicts in `runtime.ts`) · **Effort:** M · **Risk:** MEDIUM
- **Acceptance:** tools before a pause run exactly once across pause/resume; malformed checkpoint yields a fresh turn with notice.
- **Tests:** scripted-provider specs for parsed and native modes.

### P1-2 Cancellation, timeouts, iteration-cap signalling
- **Findings:** CQ-006, CQ-005
- **Files:** `packages/agents/src/runtime.ts`, `packages/core/src/ports/*` (add `signal` to tool ctx), `packages/models/src/providers/openai-compatible.provider.ts`, `packages/tools/src/gateway.ts`
- **Change:** per-run `AbortController` map; `stop()` aborts (no stale flags); signal + idle timeout to providers and tool calls; visible notice + progress + metric when cap hit.
- **Deps:** P1-1 · **Effort:** M · **Risk:** MEDIUM
- **Acceptance:** `stop()` interrupts stalled stream <100 ms and a running `http_request`; stop on idle session has no effect on next run; cap notice present.
- **Tests:** stalled-provider spec, idle-stop spec, cap spec.

### P1-3 Per-session serialization and async inbound
- **Findings:** CQ-007 (+ CQ-021 lost updates)
- **Files:** `packages/platform/src/gateway-worker.ts`, `packages/channels/src/create-channels.ts`, `packages/events/src/local-event-bus.ts` (no API change)
- **Change:** inbound handler enqueues run request without awaiting completion; worker keeps a keyed queue per `sessionId` with a global concurrency limit.
- **Deps:** P1-2 (abort on queue drain/shutdown) · **Effort:** L · **Risk:** MEDIUM–HIGH (ordering semantics visible to users) — ship behind a config flag first.
- **Acceptance:** Telegram poll keeps polling during a 30 s turn; two concurrent messages on one session produce both turns in history in arrival order.
- **Tests:** integration with scripted slow provider; concurrency spec.

### P1-4 Channel lifecycle fixes
- **Findings:** CQ-008
- **Files:** `packages/channels/src/{discord,slack}.ts`, optionally a shared `reconnectLoop` in `base-channel-adapter.ts`
- **Change:** `stopping` flag, detach `onclose` on stop, capped exponential backoff with jitter, catch `start()` errors inside the loop; Slack `apps.connections.open`; Discord sequence/ACK/RESUME; inject `WebSocket` factory for tests.
- **Deps:** none · **Effort:** M · **Risk:** MEDIUM (needs manual check against real Slack/Discord)
- **Acceptance:** no reconnect after `stop()`; recovers after 3 failed `start()`s; app token absent from URLs.
- **Tests:** fake-socket specs; manual smoke against sandbox workspaces.

### P1-5 Recursion and orchestration limits
- **Findings:** CQ-009, CQ-010
- **Files:** `packages/skills/src/executor.ts`, `packages/agents/src/orchestrator.ts`
- **Change:** skill call-stack guard (depth 8 + cycle); orchestrator: distinct `awaiting_approval` status, retry only retryable errors, reuse session across attempts, `maxConcurrency`, `maxDepth`, awaited publish.
- **Deps:** P1-1 (typed error from `run`) · **Effort:** M · **Risk:** LOW–MEDIUM
- **Acceptance & tests:** cycle spec; orchestrator specs for each branch.

### P1-6 Break up god modules (incremental, verbatim moves first)
- **Findings:** CQ-011
- **Files:** `apps/cli/src/main.ts` → `apps/cli/src/commands/*.ts`; `packages/platform/src/index.ts` → `platform/src/handlers/*.ts`; `slash-commands-extras.ts` → per-domain modules
- **Change:** move code without behaviour change, one command group / handler per PR; then route CLI subsystem construction through platform factories.
- **Deps:** best after P1-1..P1-3 land (avoid conflicts) · **Effort:** L (series of S PRs) · **Risk:** LOW per step
- **Acceptance:** `main.ts` < 300 lines (dispatcher + help); `createPlatform` contains wiring only; each extracted handler has a unit test.
- **Tests:** existing integration suite after every move; new handler specs.

### P1-7 Shutdown correctness
- **Findings:** CQ-015
- **Files:** `apps/cli/src/main.ts:310-328`, `apps/worker/src/main.ts`, `packages/platform/src/unified-gateway.ts:174-185`
- **Change:** shared `gracefulShutdown(stages, {timeoutMs})`; SIGINT+SIGTERM everywhere; exit 1 on boot failure; stop producers (channels, automation, hooks) → drain runs → close bus → close server → OTel.
- **Deps:** P1-3 for drain · **Effort:** S · **Risk:** LOW
- **Acceptance:** SIGTERM to worker exits 0 after stopping channels; boot failure exits 1.

## P2 — Medium priority (modularity, observability, testability)

| Task | Findings | Files | Change | Deps | Effort | Risk | Acceptance / tests |
|---|---|---|---|---|---|---|---|
| P2-1 Structured logging + run ids | CQ-018 | runtime, gateway-worker, tools gateway, channels | adopt `createLogger`; `runId` per turn bound in child logger + spans for model/tool/channel | P1-3 | M | LOW | log lines carry `sessionId`,`runId`; span tree per turn in OTel test exporter |
| P2-2 Error-handling sweep | CQ-012, CQ-032 | 149 `catch {}` sites, priority: config/persistence | `isNotFound`, `logError`, `cause` chaining; hook failures logged not thrown | P2-1 | M | LOW | malformed config errors visible; grep shows no bare catch on config/persistence paths |
| P2-3 Storage integrity & containment | CQ-013, CQ-014 | `storage/src/filesystem.ts`, tools builtins, `learning/skill-evolution.ts` | shared `resolveInside` + realpath; atomic write via temp+rename; learning writes through storage | none | S | LOW | sibling-prefix and symlink specs; crash-sim spec |
| P2-4 Memory consolidation | CQ-021 | `memory/src/{filesystem-memory,provider-factory}.ts` | one implementation; idempotent long-term writes; bounded/lazy `getContext` | P1-3 | M | MEDIUM | no duplicate rows after error+retry; per-turn reads O(1) in long-term size |
| P2-5 Accounting & events | CQ-019, CQ-020 | runtime `done` chunk, platform index, gateway-worker | carry actual provider/model on completion; remove `onProgress` duplicate path | none | S | LOW | audit row provider matches agent provider; one progress event per phase |
| P2-6 Lint/format enforcement | CQ-017 | all package.json, CI | add `lint` script everywhere, baseline warnings; one Prettier commit; `format:check` in CI | none | S (+M fallout) | LOW | CI fails on lint/format regressions in every package |
| P2-7 Test gaps | CQ-028, CQ-022 | `auth`, `credentials`, `storage`, `execution`, breaker | unit specs listed in 08 §2; single-probe breaker | P0/P1 tasks supply many | M | LOW | each listed scenario has a spec |
| P2-8 Remove dead code / tier leak | CQ-024 | `packages/tools/src/legacy.ts`, `tools` package.json, `packages/tool-bus` | delete legacy exports + `@anvio/db` dep; wire `tool-bus` into gateway (as part of P0-2 follow-up) or mark experimental | none | S | LOW | `@anvio/tools` has no `@anvio/db` dependency; build green |
| P2-9 Tool definition single source | 03 §7 | `tools/src/{tool-schemas,tool-descriptions,gateway}.ts`, core schema | one registry object per tool (schema, description, default, handler) | P0-2 | M | MEDIUM | adding a tool touches one file; types link schema ↔ handler |
| P2-10 Validate tool arguments | 04 §6 | `tools/src/builtins/index.ts` | validate against advertised JSON schema; return validation errors to the model | P2-9 | M | MEDIUM | missing required arg → `failed` with field name |

## P3 — Optional (cleanup, DX)

| Task | Findings | Change | Effort |
|---|---|---|---|
| P3-1 | CQ-026 | central `runtime-defaults.ts`; expose iteration cap / TTLs in agent spec | S |
| P3-2 | CQ-027 | `execFile` async + timeout + `BatchMode`/`ConnectTimeout` in ssh/singularity | S |
| P3-3 | CQ-029 | CI matrix Node 22 + 24; raise `engines` (also fixes global `WebSocket` reliance) | S |
| P3-4 | CQ-030 | warn at boot / refuse daemon start with mock provider unless `ANVIO_ALLOW_MOCK=1` | S |
| P3-5 | CQ-031 | async `scrypt` or derived-key cache | S |
| P3-6 | 02 §1 | rename overloaded "gateway"/"runtime" types in new code; rename phase-coded integration specs when touched | S (ongoing) |
| P3-7 | 02 §7 | drop `walkFallbackChain` legacy overload; remove `export *` barrel from `runtime.ts` | S |

## Dependency graph between tasks

```
P0-1  P0-2 ─► P2-9 ─► P2-10      P0-3   P0-4
            └► P2-8 (tool-bus wiring)
P1-1 ─► P1-2 ─► P1-3 ─► P1-7
  └──► P1-5        └──► P2-1 ─► P2-2
                   └──► P2-4
P1-4 (independent)   P1-6 (after P1-1..P1-3)   P2-3, P2-5, P2-6, P2-7 (independent)
```

## Coverage check

Every HIGH and CRITICAL finding maps to a P0/P1 task: CQ-001→P0-1, CQ-002→P0-2, CQ-003/033/034→P0-3, CQ-016→P0-4, CQ-004→P1-1, CQ-005/006→P1-2, CQ-007→P1-3, CQ-008→P1-4, CQ-009/010→P1-5, CQ-011→P1-6. MEDIUM findings map to P1-7 or P2; LOW to P3.
