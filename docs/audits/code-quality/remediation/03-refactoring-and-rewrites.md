# 03 — Refactoring and Rewrites

Intervention levels: L1 local cleanup · L2 function/class · L3 module restructuring · L4 subsystem redesign · L5 rewrite.

## 1. Inventory

| Module | Level | Reason |
|---|---|---|
| `agents/src/runtime.ts` (`DefaultAgentRuntime`) | **L4** | Approval checkpoint loss, silent cap, no cancellation and duplicated tool loops all lived in one ~290-line generator |
| `agents/src/tool-loop.ts` + `native-tool-loop.ts` → `tool-round.ts` | **L5** | Two near-identical loops with the same defect; replaced by one |
| `agents/src/run-checkpoint.ts` | L2 | Cast → zod validation, versioning |
| `agents/src/orchestrator.ts` | L3 | Status, retry classification, concurrency, depth, fan-in session |
| `skills/src/condition-expression.ts` (new) | **L5** (of the condition evaluator) | `new Function` cannot be made safe |
| `skills/src/executor.ts` | L2 | Validation up-front, recursion guard |
| `skills/src/catalog-resolver.ts` | L2 | Containment, parse errors surfaced |
| `execution/src/sandbox/process-sandbox.ts` | **L4** | Env, kill semantics, capture, docker cleanup |
| `tools/src/builtins/egress.ts` (new) + network builtins | L3 | Egress policy |
| `tools/src/gateway.ts` | L2 | Fail-closed load, hook isolation |
| `storage/src/filesystem.ts` | L2 | Containment, atomic writes, error distinction |
| `channels/src/{slack,discord}.ts` lifecycle | **L4** (connection lifecycle only) | Reconnect-after-stop, dead reconnect chain, token in URL, missing RESUME/ACK |
| `channels/src/telegram.ts` poll dispatch | L2 | Head-of-line blocking |
| `channels/src/channel-session-bridge.ts` | L1 | Duplicate-session race |
| `models/src/circuit-breaker.ts` | L1 | Single probe |
| `memory` (3 stores) | L2 | Duplicate writes |
| `credentials/src/encrypted-store.ts` | L2 | Async KDF, key cache, serialized puts |
| `runtimes` ssh/singularity/remote/docker | L2 | Async exec, timeouts |
| `platform/src/gateway-worker.ts` | L3 | Per-session queue, run ids, structured logs |
| `platform/src/index.ts` (`createPlatform`) | L3 | Handler + mock extracted, ordered shutdown, logging |
| `platform/src/process-guards.ts` | L2 | Shutdown helpers |
| `apps/cli/src/main.ts` | **L3** | God file split into command modules |
| `learning/src/skill-evolution.ts` | L2 | Slug containment, atomic writes, error surfacing |
| `apps/{worker,gateway,api}` entry points | L1 | Signals, exit codes |

## 2. L4/L5 changes — design records

### 2.1 Agent runtime + tool round (L4/L5)

- **Current behaviour (before):** see audit CQ-004/005/006/025.
- **Root problems:** one generator owned prompt assembly, routing, streaming, two tool-loop variants, checkpointing and persistence; tool results of a paused round were never in the checkpoint; no cancellation primitive.
- **Design:** `stream()` = `prepareTurn` → loop { `streamModelIteration` (yields chunks, returns text/tool calls/served-by) → `executeToolRound` (yields progress, returns one message per call + optional pending approval) } → persist. Per-session `AbortController`; `guardStream` for idle timeout.
- **Affected contracts:** stream event fields (additive), checkpoint shape (v2, v1 readable), `run()` error type (subclass).
- **Migration:** none needed; v1 checkpoints keep working; a checkpoint written by the new code is not readable by the old code (rollback after a paused turn loses that pause).
- **Rollback:** revert the agents package; sessions paused under v2 must be re-asked.
- **Verification:** 10 pre-existing runtime tests unchanged and passing; 14 new lifecycle tests.

### 2.2 Skill condition evaluator (L5)

- **Before:** `new Function(...keys, 'return !!(cond)')` — full host access; syntax errors → false.
- **Alternatives considered:** `node:vm` (rejected: not a security boundary); `expr-eval`/`jsep` (rejected: new dependency, different grammar); keep `new Function` with frozen globals (rejected: still escapable via constructors).
- **Design:** tokenizer → recursive-descent parser → evaluator over an explicit scope; documented grammar only.
- **Preserved:** `==` loose equality, unknown variable → false, optional chaining, `??`, template literals, `includes/startsWith` style calls.
- **Changed:** syntax outside the subset fails the skill before any step runs (`INVALID_CONDITION`).
- **Verification:** 29 evaluator tests; all bundled skill conditions validate.

### 2.3 Process sandbox (L4)

- **Before:** inherited env; direct-child SIGKILL (pipes held open by grandchildren could hang `close`); unbounded capture; docker container left running on timeout.
- **Design:** allow-listed env (`buildSandboxEnv`), detached process group killed as a group, capped capture, named docker container removed on timeout.
- **Preserved:** request `env`, `cwd`, exit-code semantics (124 on timeout), audit log.
- **Changed:** child processes no longer see host secrets; operators can pass variables explicitly via `ANVIO_SANDBOX_ENV_PASSTHROUGH`.
- **Verification:** 5 sandbox tests + existing code-execution integration test.

### 2.4 Socket channel lifecycle (L4, Slack/Discord only)

- **Before:** reconnect after `stop()`; `void this.start()` — first failure ended reconnects; fixed 5 s; Slack token in WSS URL; Discord heartbeat without sequence/ACK, no RESUME.
- **Design:** `ReconnectScheduler` (backoff + jitter, stop-aware, retries failures); Slack `apps.connections.open`; Discord sequence, ACK watchdog, RESUME, fatal-code stop; id-based dedupe.
- **Preserved:** message handling, approvals, typing, splitting — untouched.
- **Verification:** 10 tests with a fake WebSocket. **Live protocol behaviour not verified** (status NOT VERIFIED).

## 3. Refactors without behaviour change

- CLI split (verbatim move; help and dispatch identical; smoke-tested).
- Run-completed handler extraction (same logic, now unit-tested; provider attribution fix is the only behaviour change and is a confirmed defect).
- Mock provider moved to its own file.
- Memory dedupe helper shared by three stores.
- `executeToolRound` replacing duplicated `approvalSummaryFromResult`.

## 4. Behaviour changes for confirmed defects

| Change | Finding | Who notices |
|---|---|---|
| Boot fails for `auth.provider: jwt` without `JWT_SECRET` | CQ-001 | insecure deployments |
| Network tools refuse loopback/private/metadata targets unless allow-listed | CQ-002 | agents calling internal services (must add `network.allowHosts`) |
| Invalid `tools/gateway.yaml` fails boot instead of using defaults | CQ-012 | broken configs |
| Sandbox child processes do not see host env beyond the allow-list | CQ-003 | scripts relying on inherited secrets |
| `execute_code` without an executor fails instead of evaluating in-process | CQ-033 | `anvio tools test anvio_tools__execute_code` |
| Skill conditions outside the subset fail validation | CQ-034 | skills with exotic conditions |
| Iteration cap reached → visible notice, `stopReason: iteration_limit` | CQ-005 | users of long tool loops |
| `stop()` on an idle session no longer kills the next turn | CQ-006 | — |
| A second concurrent turn on one session is rejected (`session_busy`) by the runtime; the worker queues instead | CQ-007 | direct runtime callers |
| Resume without a valid checkpoint returns an error instead of running an empty turn | CQ-023 | — |
| Sub-agent awaiting approval → task `awaiting_approval`, plan `partial` | CQ-010 | orchestration consumers |
| Non-retryable sub-agent errors are not retried | CQ-010 | — |
| Fan-in synthesis runs in a child session | CQ-040 | manager history no longer gets a synthetic message |
| Token audit records the serving/configured provider | CQ-019 | usage reports |
| Long-term memory no longer gets duplicate entries; tool-turn questions are now stored | CQ-021 | recall results |
| `/draft`, `/discard`, `/promote` reject slugs that leave the drafts dir | CQ-035 | — |
| Discord: no reconnect on fatal close codes (e.g. 4004 bad token) | CQ-008 | misconfigured bots stop retrying |
