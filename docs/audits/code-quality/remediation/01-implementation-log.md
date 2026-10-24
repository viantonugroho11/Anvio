# 01 — Implementation Log

Branch: `fix/code-quality-remediation` (from `origin/main` @ `4f17409`). Nothing committed. Baseline before any change: the audited code was unchanged since revision `156c526` (`git diff 156c526 HEAD -- packages apps tests` empty), so every finding was revalidated against the same code the audit read; 800/800 tests passing.

Status legend: **FIXED** (implemented and verified by tests) · **PARTIALLY FIXED** · **NOT VERIFIED** (implemented, verification incomplete) · **BLOCKED** · **NOT REPRODUCIBLE** · **ACCEPTED RISK**.

Verification evidence refers to tests in `04-regression-test-results.md`; "suite" means the full run (168 files / 957 tests, all passing).

---

## Security and data integrity

### CQ-001 — JWT secret fallback `'dev-secret'` · **FIXED**
- **Root cause:** `createAuthProvider` substituted a literal when `JWT_SECRET` was missing.
- **Solution:** `requireJwtSecret()` throws `AnvioError('VALIDATION_ERROR')` when the secret is missing or blank; warns below 32 characters; `jwt.verify` pinned to `HS256`.
- **Files:** `packages/auth/src/index.ts`, new `packages/auth/src/index.spec.ts`.
- **Evidence:** 7 tests — missing/blank secret throws, short secret warns, `dev-secret`-forged token rejected, `alg: none` and HS512 rejected, valid token accepted.
- **Behaviour change:** platform boot fails when `auth.provider: jwt` is enabled without `JWT_SECRET` (previously silently insecure).

### CQ-002 — Network tools without egress policy · **PARTIALLY FIXED**
- **Root cause:** model-supplied URLs passed straight to `fetch`; redirects followed automatically; bodies fully buffered.
- **Solution:** new `tools/src/builtins/egress.ts`: `assertEgressAllowed` (http/https only; resolves DNS; blocks loopback, RFC1918, CGNAT, link-local/metadata, ULA, multicast, IPv4-mapped IPv6), `guardedFetch` (manual redirects, every hop re-checked, max 5), `readBodyCapped` (streamed byte cap). Used by `web_fetch`, `web_extract`, `http_request`, and the first URL of `browser`/`browser_navigate`. New `network` block in the gateway schema (`allowPrivateNetwork`, `allowHosts`, `maxResponseBytes`, defaults secure). `http_request` timeout clamped to 60 s. Run cancellation signal propagated into these requests.
- **Files:** `packages/tools/src/builtins/{egress,web-fetch,web-extract,network-tools,index}.ts`, `packages/tools/src/gateway.ts`, `packages/core/src/schemas/tool-gateway.schema.ts`.
- **Evidence:** `egress.spec.ts` (25 tests incl. redirect-to-metadata, `localhost` resolution, byte cap).
- **Remaining:** `http_request` stays enabled by default (changing a default is a contract change — needs approval); POST to *public* hosts remains possible by design; DNS-rebinding TOCTOU between check and connect (documented in code); browser sub-resources unchecked.

### CQ-003 — Process sandbox leaks secrets / no network isolation · **PARTIALLY FIXED**
- **Root cause:** `env: { ...process.env, … }`; kill targeted only the direct child; unbounded capture.
- **Solution:** `buildSandboxEnv` (core) passes only an allow-list (`PATH`, `HOME`, locale, temp, Go paths, …) plus explicit request env and `ANVIO_SANDBOX_ENV_PASSTHROUGH`; child spawned `detached` and killed by process group; stdout/stderr capped (1 MB default, truncation noted); docker runs get a container name and `docker rm -f` on timeout. Background `terminal` processes use the same env policy.
- **Files:** `packages/core/src/sandbox-env.ts`, `packages/execution/src/sandbox/process-sandbox.ts`, `packages/execution/src/index.ts`, `packages/tools/src/builtins/process-manager.ts`.
- **Evidence:** `process-sandbox.spec.ts` (secret not visible to child; grandchild killed on timeout in < 5 s; 200 kB output capped). `code-execution.integration.spec.ts` still passes.
- **Remaining:** host runtimes (shell/python/node/go) still have network access when `networkEnabled: false` — only docker isolates. Documented on the option; see `05-remaining-issues.md`.

### CQ-013 — Path containment prefix bug · **FIXED**
- **Solution:** `resolveInsideRoot` (lexical, `path.relative`-based) and `resolveRealInsideRoot` (also checks realpath of target or nearest existing ancestor) in core; four copies replaced (storage provider, `filesystem.ts`, `patch-file.ts`, `workspace-tools.ts`) plus `appendJsonl`.
- **Files:** `packages/core/src/fs-paths.ts`, storage and tools builtins.
- **Evidence:** `fs-paths.spec.ts` (sibling prefix, symlink escape, new paths), `filesystem.spec.ts`.

### CQ-014 — Non-atomic writes · **FIXED**
- **Solution:** `writeFileAtomic` (core) writes a uniquely named sibling temp file and renames; `list()` hides in-flight temp files. Used by the storage provider, harness engagement store, skill drafts and promotion.
- **Evidence:** `filesystem.spec.ts` — failed rename keeps old content and leaves no temp file.

### CQ-016 — Vulnerable dependencies · **PARTIALLY FIXED**
- **Solution:** `next` ^15.5.28; `@modelcontextprotocol/sdk` ^1.32.0 (direct dep in runtimes to satisfy the agent-SDK peer); OTel `sdk-node`/`exporter` ^0.300, `auto-instrumentations-node` ^0.82, `resources` ^3, `api` ^1.10; overrides for `proxy-addr`, `multer`, `brace-expansion`, `source-map-js`, `qs`, `ip-address`, `body-parser` (new advisory surfaced during work), zod 4 consumers ≥ 4.6.6. CI gains `pnpm audit --prod --audit-level=critical`. Installs were run with TLS verification on (`NODE_TLS_REJECT_UNAUTHORIZED` unset for the command).
- **Evidence:** `pnpm audit --prod`: 32 advisories (2 critical, 12 high) → **1 high** (zod 3.25.76 in `@anvio/core`/`knowledge`/`tool-bus`). Build, typecheck, full suite green after upgrades.
- **Remaining:** zod 3 → 4 migration **BLOCKED** (see 05): it changes `.default()` semantics used throughout core schemas.

### CQ-033 — In-process `execute_code` fallback · **FIXED**
- **Solution:** fallback removed (returns `failed: codeExecutor required`); `executeCode` no longer exported from `@anvio/tools`.
- **Evidence:** `gateway-load.spec.ts` — probe global not set, call fails.

### CQ-034 — Skill conditions evaluated as host JS · **FIXED**
- **Solution:** new `skills/src/condition-expression.ts` — tokenizer + recursive-descent parser + evaluator for the documented subset (literals, template literals, arrays, `.`/`?.`/`[]`, unary/binary/ternary, `??`, allow-listed string/array methods); no globals; `__proto__`/`constructor`/`prototype` blocked; own properties only. `executeSkill` validates every condition before the first step (`SkillStepError('INVALID_CONDITION')`); unknown variables still evaluate to "false", as before.
- **Evidence:** `condition-expression.spec.ts` (29 tests incl. `process`, `globalThis`, constructor walks), `executor.spec.ts`. All 11 bundled/workspace skill definitions load and their conditions validate.
- **Behaviour change:** a condition using syntax outside the subset now fails the skill up-front instead of silently evaluating to false.

---

## Runtime correctness and lifecycle

### CQ-006 — No cancellation/timeouts · **FIXED** (local runtime)
- **Solution:** `DefaultAgentRuntime` keeps one `AbortController` per running session; `stop()` aborts it (no stale stop flags); the signal goes to the provider request (`AbortSignal.any` with a per-call controller) and to every tool call (`RuntimeToolContext.signal`, passed through `ToolGateway` to network tools); `guardStream` enforces an idle timeout (default 300 s, `ANVIO_MODEL_IDLE_TIMEOUT_MS`) independent of the provider honouring the signal; tool calls are raced against the signal (`abortable`). Error events carry `code` (`stopped`, `model_idle_timeout`, `provider_error`, `invalid_checkpoint`, `session_busy`) and `retryable`.
- **Evidence:** `runtime-lifecycle.spec.ts` — stop interrupts a stalled stream in < 500 ms and a running tool; idle-session stop does not cancel the next turn; idle timeout before/after output; signal reaches provider.
- **Limits:** vendor runtimes (Claude Code, Cursor, Codex…) are not stoppable through this path; a tool that ignores `ctx.signal` keeps running in the background after the turn ends.

### CQ-007 — Serial bus dispatch / concurrent turns per session · **FIXED** (Level 1)
- **Solution:** `KeyedSerialQueue` + `Semaphore` (core). Gateway worker runs turns one at a time per session, at most `ANVIO_MAX_CONCURRENT_RUNS` (8) overall; a run queued behind another turn does not block its publisher (avoids deadlock with mid-turn approvals). Telegram dispatches updates without awaiting them — ordered per chat/topic, callbacks never queued. The runtime rejects a second concurrent turn on one session (`session_busy`).
- **Found while verifying:** `ChannelSessionBridge.resolveOrCreate` created **two sessions** for two first messages in a new thread → fixed with the same queue (CQ-037).
- **Evidence:** `session-serialization.integration.spec.ts` (fails on the old code: peak concurrency 2 and split sessions), `telegram-dispatch.spec.ts`, `concurrency.spec.ts`.
- **Limits:** arrival order of two messages dispatched concurrently by an adapter is not guaranteed; NATS (Level 3) mode not exercised.

### CQ-008 — Channel stop/reconnect · **NOT VERIFIED** (simulated only)
- **Solution:** `ReconnectScheduler` (capped, jittered exponential backoff; stops for good on `stop()`; retries failed reconnects) and `RecentIds` dedupe. Slack: `apps.connections.open` with the app token in the `Authorization` header (no token in the URL), `hello` resets backoff, redelivered envelopes acked but not re-handled. Discord: `onclose` detached on stop, heartbeat carries the last sequence, missing ACK closes zombie sockets, RESUME via `resume_gateway_url`, fatal close codes stop reconnecting, message-id dedupe.
- **Evidence:** `socket-lifecycle.spec.ts` (fake WebSocket + fake timers). **Not verified against live Slack or Discord.**

### CQ-015 — Shutdown paths · **FIXED**
- **Solution:** `runShutdownSteps` (ordered, logged failures, 10 s cap) and `exitOnShutdownSignals` (SIGINT+SIGTERM, all registered handlers, second signal exits). Platform shutdown stops producers before closing the bus; unified gateway closes HTTP, web chat, platform, telemetry in order; worker handles SIGTERM and exits 1 on boot failure; CLI waits for cleanup before `process.exit(130/143)`; API exits 1 on boot failure.
- **Files:** `packages/platform/src/{process-guards,index,unified-gateway,platform-context}.ts`, `apps/{worker,gateway,api,cli}/src/*`.
- **Evidence:** `process-guards.spec.ts`; `shutdown-signals.integration.spec.ts` sends real SIGTERM/SIGINT to a child process and observes async cleanup finishing before exit.

### CQ-022 — Half-open breaker herd · **FIXED**
- **Solution:** single probe tracked by `probeStartedAtMs`; an unresolved probe expires after one cooldown.
- **Evidence:** `circuit-breaker.spec.ts` (+2 cases).

### CQ-027 — `spawnSync` behind async methods · **FIXED**
- **Solution:** `execCommand` (async `execFile`, timeout, SIGKILL, buffer cap) for ssh/singularity/remote stubs; ssh adds `BatchMode=yes`, `ConnectTimeout=10`; sync `isConfigured()` probes bounded to 5 s.
- **Evidence:** `exec-command.spec.ts` (event loop keeps running, timeout → 124, missing binary throws).

### CQ-031 — `scryptSync` per credential op · **FIXED**
- **Solution:** async `scrypt` for `put`/`get`, derived-key cache per salt (256 entries), sync `encrypt`/`decrypt` kept for API compatibility; `put` serialized per pool (it was read-modify-write — concurrent puts lost credentials, CQ-041).
- **Evidence:** `encrypted-store.spec.ts` (round-trip, legacy blob compatibility, wrong passphrase, 8 concurrent puts).

---

## Agent core

### CQ-004 / CQ-025 — Approval pause dropped tool results; duplicated loops · **FIXED**
- **Solution:** `tool-loop.ts` and `native-tool-loop.ts` replaced by one `executeToolRound` generator. Every call gets a result message — real results, "awaiting human approval", or "not executed" — and the checkpoint stores the assistant turn plus all of them.
- **Evidence:** `runtime-lifecycle.spec.ts` (native and fenced formats): completed tool runs exactly once across pause/resume; the resumed request contains its result.

### CQ-023 — Unvalidated checkpoint · **FIXED**
- **Solution:** zod-validated, versioned (`version: 2`) checkpoint; v1 still readable; resume without a valid checkpoint returns `invalid_checkpoint` instead of running an empty turn.
- **Evidence:** lifecycle spec (missing, corrupt, v1 cases).

### CQ-005 — Silent iteration cap · **FIXED**
- **Solution:** visible notice, progress event, warning, `done.stopReason: 'iteration_limit'`.
- **Evidence:** lifecycle spec.

### CQ-009 — Unbounded skill recursion · **FIXED**
- **Solution:** `AsyncLocalStorage` call stack in `executeSkill` (covers `skill:` steps, `skill_call`, `skill__<slug>`): cycle → `SKILL_CYCLE`, depth > 8 rejected.
- **Evidence:** `executor.spec.ts`.

### CQ-010 — Orchestrator status/retry/concurrency · **FIXED**
- **Solution:** `awaiting_approval` task status (plan → `partial`, dependents skipped); retries only retryable errors (`isRetryableRunError`), jittered backoff; agent loaded once (load failure not retried); failed attempt sessions marked `failed`; `maxConcurrency` (4) and `maxDepth` (3); publish errors caught. Fan-in synthesis now runs in a child session (CQ-040).
- **Evidence:** `orchestrator.spec.ts` (7 cases), `delegation.integration.spec.ts`.

### CQ-019 — Wrong provider in token audit · **FIXED**
- **Solution:** runtime `done` carries `provider`/`model` from the router; worker and CLI forward them on `AGENT_RUN_COMPLETED`; audit prefers event → agent config → platform default.
- **Evidence:** `run-completed.spec.ts`.

### CQ-020 — Duplicate progress events · **FIXED**
- **Solution:** platform no longer passes `onProgress` (which republished each phase as `channel: 'cli'`); tool-round progress is now yielded on the stream.

### CQ-021 — Duplicate memory writes · **PARTIALLY FIXED**
- **Solution:** `newConversationEntries` stores only messages after the common prefix with the previous history, user/assistant text only; applied to all three `storeConversation` implementations.
- **Evidence:** `conversation-entries.spec.ts`.
- **Remaining:** `getContext` still loads all long-term entries of the session each turn.

---

## Architecture, errors, observability, tooling

### CQ-011 — God modules · **PARTIALLY FIXED**
- **Done:** `apps/cli/src/main.ts` 2 883 → 262 lines (dispatcher + help) via a script-driven verbatim move into `cli-context.ts` and `commands/{sessions,identity,planning,runtime,skills,gateway}.ts`, imports pruned by the TypeScript language service; run-completed handler and mock provider extracted from `createPlatform`; `DefaultAgentRuntime.stream` split into `prepareTurn` / `streamModelIteration` / `handleModelChunk` / `executeToolRound`.
- **Remaining:** `registerPlatformExtras` (~1 280 lines) not split; CLI command modules still build subsystems directly.

### CQ-012 — Silent catches · **PARTIALLY FIXED**
- **Done:** `ToolGateway.load` fails on invalid files; storage `read/exists/delete/list` only treat ENOENT/ENOTDIR as missing; skill catalog distinguishes missing from invalid; A2A boot, default soul, draft announcement, runtime best-effort paths now log. Bare `catch {` in source: 149 → 133.

### CQ-017 — Lint/format coverage · **PARTIALLY FIXED**
- **Done:** `lint` script added to 19 packages; config gains `varsIgnorePattern`, `prefer-const` `ignoreReadBeforeAssign`; 7 surfaced errors fixed; lint passes on all 40 workspace packages (11 warnings in `a2a`).
- **Remaining:** Prettier still reports 383 files (was 388) — every new file and every file my edits touched is formatted; a repo-wide reformat is left for a dedicated commit.

### CQ-018 — Observability · **PARTIALLY FIXED**
- **Done:** gateway worker generates a `runId` per turn, puts it on the `agent.run` span, in `UserInput.metadata`, and on every log line via a pino child logger; runtime warnings routed to `createLogger('agents:runtime')`.
- **Remaining:** no spans for model/tool calls; 400 `console.*` calls remain elsewhere.

### CQ-024 — Dead code / tier leak · **PARTIALLY FIXED**
- **Done:** `tools/src/legacy.ts` deleted, `@anvio/db` removed from `@anvio/tools`; `tool-bus` header corrected to say it is not enforced.
- **Remaining:** `tool-bus` still unwired (see 05).

### CQ-026 — Magic numbers · **PARTIALLY FIXED**
- Runtime constants named (`APPROVAL_TTL_MS`, `DEFAULT_MODEL_IDLE_TIMEOUT_MS`, `MAX_HTTP_TIMEOUT_MS`, `MAX_HTTP_BODY_CHARS`, `DEFAULT_ORCHESTRATION_*`, `DEFAULT_MAX_CONCURRENT_RUNS`); no central config module.

### CQ-028 — Test gaps · **PARTIALLY FIXED**
- New unit tests for `auth`, `storage`, `credentials`, `execution`, runtime lifecycle, orchestrator, channels lifecycle, platform handlers, shutdown. Still none for `hooks`, `workflows`, `batch`, `kanban`, `blueprints`, `goals`, `acp`.

### CQ-029 — Node version · **PARTIALLY FIXED**
- CI tests on Node 22 and 24; `engines` left at `>=20` (raising it is a contract change — see 05).

### CQ-030 — Silent mock provider · **FIXED**
- Boot warning when no credentials are found outside simulation.

### CQ-032 — Hook failure / shared context · **FIXED**
- `onToolCompleted` errors are logged, not propagated; `mergeContext` documented as boot-time only (all call sites are boot-time — cross-session bleed not reproducible).
- **Evidence:** `gateway-load.spec.ts`.

---

## New findings discovered and fixed during remediation

| ID | Severity | Issue | Fix | Evidence |
|---|---|---|---|---|
| CQ-035 | HIGH | `/draft`, `/discard`, `/promote <slug>` (typed in chat) joined the slug into paths unchecked: read, move or copy any reachable file. Write errors in promote were swallowed as "Draft not found". | `draftPath()` via `resolveInsideRoot`; promote writes atomically and surfaces errors | `skill-evolution.spec.ts` traversal test |
| CQ-036 | MEDIUM | Harness engagement store used `${file}.${pid}.tmp`: overlapping writes to one thread failed with ENOENT | shared `writeFileAtomic` with unique temp names | serialization integration test (was failing on it) |
| CQ-037 | HIGH | `ChannelSessionBridge.resolveOrCreate` lookup-then-create race split a new thread into two sessions | per-thread `KeyedSerialQueue` | serialization integration test |
| CQ-038 | MEDIUM | Skill catalog `load` joined model-supplied slugs unchecked (`skill_view`/`skill_call`) and reported YAML errors as "not found" | `resolveInsideRoot`; parse errors name the file; `SkillNotFoundError` | skills suite; all bundled skills load |
| CQ-039 | HIGH | `body-parser` 2.3.0 advisory (GHSA-27r3-jxmh-p828) via `@a2a-js/sdk` | override `>=2.4.0` | `pnpm audit` |
| CQ-040 | MEDIUM | Fan-in synthesis ran on the manager's own session — appended a synthetic message to the user's history and re-entered the manager's running turn | child session for synthesis | delegation integration test |
| CQ-041 | MEDIUM | Concurrent credential `put`s to one pool lost writes (read-modify-write) | per-pool serialization | `encrypted-store.spec.ts` |
