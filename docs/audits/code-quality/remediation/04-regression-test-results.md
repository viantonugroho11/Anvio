# 04 — Regression & Test Results

Environment: macOS arm64, Node **v24.21.0**, pnpm 9.15.9. CI now targets Node 22 and 24; Node 22 was **not** run locally. All tests use scripted/fake providers, fake WebSockets, temp directories and local child processes — **no live LLM, Slack, Discord, Telegram, Postgres or NATS was contacted.**

## Baseline (before changes)

| Check | Result |
|---|---|
| Code drift vs audited revision | none (`git diff 156c526 HEAD -- packages apps tests` empty) |
| `pnpm test` | 148 files, **800 passed** |
| `pnpm build` / `typecheck` / `lint` | pass (lint covered ~20/40 packages) |
| `pnpm audit --prod` | 32 advisories (2 critical, 12 high) |

## Final run (after changes)

| Command | Result |
|---|---|
| `pnpm build` | **pass** — 40/40 tasks |
| `pnpm typecheck` | **pass** — 73/73 tasks |
| `pnpm lint` | **pass** — 73/73 tasks, now every workspace package; 0 errors, 11 warnings (`a2a`, pre-existing `no-explicit-any`) |
| `ANTHROPIC_API_KEY=test-key pnpm test` | **pass** — **168 files, 957 tests, 0 failed, 0 skipped**, 14.1 s |
| `pnpm audit --prod --audit-level=critical` | **pass** (exit 0) |
| `pnpm audit --prod` | 1 high (zod 3.25.76) — see 05 |
| `pnpm format:check` | **fail** — 383 files (was 388); all new and touched files formatted; repo-wide reformat deferred |
| CLI smoke: `node apps/cli/dist/main.js help`, `… tools list` | output unchanged in shape; commands resolve after the split |

## Tests added (157)

| File | Tests | What it proves |
|---|---:|---|
| `packages/auth/src/index.spec.ts` | 7 | no secret → boot error; `dev-secret`/`none`/HS512 tokens rejected |
| `packages/core/src/fs-paths.spec.ts` | 6 | sibling-prefix and symlink escapes rejected |
| `packages/core/src/concurrency.spec.ts` | 5 | per-key ordering, cross-key concurrency, semaphore bound |
| `packages/storage/src/filesystem.spec.ts` | 6 | ENOENT vs real errors, traversal, atomic write on failure, temp files hidden |
| `packages/tools/src/builtins/egress.spec.ts` | 25 | private ranges, DNS → loopback, redirect re-checks, body cap |
| `packages/tools/src/gateway-load.spec.ts` | 6 | invalid YAML fails closed, hook failure isolated, no in-process eval |
| `packages/execution/src/sandbox/process-sandbox.spec.ts` | 5 | env allow-list, grandchild kill, output cap |
| `packages/skills/src/condition-expression.spec.ts` | 29 | supported subset, host isolation, syntax errors |
| `packages/skills/src/executor.spec.ts` | 7 | conditions in execution, invalid condition rejected up-front, cycle and depth guards |
| `packages/agents/src/runtime-lifecycle.spec.ts` | 14 | approval mid-batch (native + parsed), resume, invalid/v1 checkpoints, iteration cap, stop, idle timeout, busy session |
| `packages/agents/src/orchestrator.spec.ts` | 7 | awaiting-approval status, retry classification, load failure, concurrency bound, depth limit |
| `packages/channels/src/socket-lifecycle.spec.ts` | 10 | Slack/Discord: no reconnect after stop, retry after failed reconnect, token not in URL, envelope dedupe, heartbeat seq, RESUME, zombie detection, fatal codes |
| `packages/channels/src/telegram-dispatch.spec.ts` | 4 | slow chat does not block another chat; per-chat order; callbacks not queued |
| `packages/memory/src/conversation-entries.spec.ts` | 3 | no duplicate long-term writes after unfinished/retried turns |
| `packages/credentials/src/encrypted-store.spec.ts` | 5 | round-trip, legacy compatibility, wrong passphrase, concurrent puts |
| `packages/platform/src/handlers/run-completed.spec.ts` | 6 | token audit provider attribution, draft prompt, failure tolerance |
| `packages/platform/src/process-guards.spec.ts` | 2 | ordered shutdown, timeout |
| `packages/runtimes/src/exec-command.spec.ts` | 4 | non-blocking, exit codes, timeout, missing binary |
| `tests/integration/session-serialization.integration.spec.ts` | 1 | full platform + worker: two messages in one new thread → one session, peak concurrency 1, both turns kept |
| `tests/integration/shutdown-signals.integration.spec.ts` | 2 | real SIGTERM/SIGINT to a child: async cleanup completes, exit codes |
| added to `circuit-breaker.spec.ts` | 2 | single half-open probe, probe expiry |
| added to `skill-evolution.spec.ts` | 1 | draft-slug traversal rejected for draft/discard/promote |

Tests that fail on the pre-remediation code were confirmed for the serialization integration test (peak concurrency 2, then two sessions) and, by construction, for checkpoint, cap, traversal, egress and sandbox-env tests (they assert behaviour the old code did not have).

## Existing failures / new regressions

- Existing failures before changes: **none**.
- Regressions found during the work and fixed before the final run: lint errors in packages that were never linted (7), a shebang/import issue in the first CLI split attempt (redone), an order-dependent assertion in the new serialization test (relaxed to order-agnostic because concurrent adapter dispatch has no defined order).
- Known introduced regressions remaining: **none**.

## Compatibility checks performed

| Contract | Check |
|---|---|
| Tool schemas / names | unchanged; `tools/gateway.yaml` gains an optional `network` block with secure defaults; `workspace/tools/gateway.yaml` still validates |
| Skills | all 11 bundled + workspace skill YAML files load; both conditions in them validate |
| Persisted checkpoints | v1 checkpoints still resume (test) |
| Credential blobs | blobs from the sync API decrypt with the new code (test); format unchanged |
| Session files | storage key layout unchanged; writes now atomic |
| Stream events | `done`/`error` gain optional fields only |
| CLI | commands and help unchanged; implementation moved |

## Remaining coverage gaps

- Coverage percentage **not measured** (no coverage provider installed).
- No live provider, channel, Postgres, NATS or Docker-sandbox verification.
- Not unit-tested: `hooks`, `workflows`, `batch`, `kanban`, `blueprints`, `goals`, `acp`, `registerPlatformExtras` slash commands.
- Node 22 path not run locally.
