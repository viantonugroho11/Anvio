# 00 — Executive Summary: Post-Refactoring Verification

**Branch:** `test/post-refactoring-verification` (based on `main` at `4e1bef5`, after PR #117)
**Date:** 2026-10-24
**Environment:** macOS (Darwin 25.6, arm64), Node v24.21.0, pnpm workspace, Level 1 storage (filesystem)

## Verdict

**READY WITH CONDITIONS** for single-process, Level 1 deployments (CLI, `anvio gateway start`) under the conditions in [06-production-readiness.md](06-production-readiness.md).

**NOT VERIFIED** for live vendor integrations (real LLM providers, Slack, Discord, Telegram and the other channels, vendor-CLI runtimes) and for Level 2+ infrastructure (SQLite under load, PostgreSQL, NATS, Qdrant). Every test in this phase scripts the model, and only the in-process simulated channel was used. A mocked test does not prove compatibility with a live service, and this report makes no claim that it does.

## What was done

1. **Revalidation.** Re-read the code-quality audit (`docs/audits/code-quality/00–11`) and the remediation reports (`remediation/00–07`), then checked them against the current code. Remediation items still open are tracked in [07-remaining-risks.md](07-remaining-risks.md).
2. **Real end-to-end verification.** Wrote 43 new E2E tests in `tests/integration/e2e/`. Each one boots the real platform: workspace loader, storage, memory, tool gateway, event bus, gateway worker, harness, channel hub, automation engine and MCP bridge. Only the model is scripted. The tests also exercise:
   - real loopback HTTP and WebSocket against the unified gateway;
   - a real MCP server process built with the official `@modelcontextprotocol/sdk`;
   - a real local HTTP service for tools;
   - real process restarts against the same workspace directory.
3. **Concurrency and load.** Ran a repeatable load spec with five profiles, from 40×3 up to 500×2 sessions×turns. Measurements: latency percentiles, throughput, error rate, peak concurrency, event-loop delay, CPU, RSS/heap, and active handles left after shutdown.
4. **Failure injection.** 11 scenarios: LLM hang, 429, invalid tool calls, throwing tool, connection refused, broken skill, storage EACCES, channel delivery failure, crash and restart, invalid workspace config, broken agent file. MCP, HTTP and scheduler failure cases are covered in their own suites.
5. **Regression fixes.** 18 defects were found. Each was reproduced by a failing test, root-caused and fixed, and its test now passes. See [05-regression-fixes.md](05-regression-fixes.md).

## Headline results

| Gate                                                     | Result                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm build`                                             | PASS: 40/40 tasks                                                                                    |
| `pnpm typecheck`                                         | PASS: 73/73 tasks                                                                                    |
| `pnpm lint`                                              | PASS: 73/73 tasks                                                                                    |
| `pnpm test` (whole repo)                                 | PASS: 178 files, 1 014 tests                                                                         |
| `pnpm test:integration`                                  | PASS: 42 files, 203 tests                                                                            |
| New E2E suite, run 3×                                    | PASS: 43/43 each run; no flakes observed                                                             |
| `pnpm audit --prod --audit-level=critical` (the CI gate) | PASS                                                                                                 |
| `pnpm audit --prod` (all severities)                     | 5 advisories: 1 high (zod 3, already tracked as CQ-016), 2 moderate, 2 low                           |
| `pnpm format:check`                                      | FAIL. The 382 files are pre-existing (CQ-017); none of the files changed in this phase is among them |

## The most serious defects found (all fixed)

- **PR-01: unbounded recursive delegation.** An agent that delegates to an agent that delegates again created 3 000+ nested sessions in three seconds. Delegation is now depth-limited (default 3), and `mixture_of_agents` fans out to at most 8 agents.
- **PR-13: fail-open workspace config.** A typo in `anvio.yaml` made the platform fall back to defaults, which **includes auth disabled**. A broken config now fails boot and names the file.
- **PR-02 / PR-03: MCP.** The stdio client used `Content-Length` framing, while the official SDK servers use newline-delimited JSON, so **no official MCP server worked**. Separately, a missing MCP binary raised an unhandled `ENOENT` that could crash the daemon.
- **PR-04 / PR-05 / PR-06: HTTP gateway.**
  - `POST /messages` returned 202 only after the whole turn had finished.
  - Malformed JSON hung the request and produced an unhandled rejection.
  - Request bodies had no size limit.
- **PR-14 / PR-15: lost turns.**
  - A broken agent file made turns disappear silently, with no reply and the session stuck as "in progress".
  - After a crash, interrupted sessions stayed `calling_model` forever.
- **PR-17: MCP child processes outlived `platform.shutdown()`.**
- **PR-18: O(N) per-message session lookup.** Every inbound channel message read every session file ever created.

## Conditions that remain

These are documented and not fixed:

- Shutdown neither drains nor aborts turns that are already running. Messages queued behind the concurrency cap at shutdown are lost, though not silently: the restart repair marks interrupted sessions `failed`.
- Level 1 throughput tops out at roughly 90–200 turns/s on this machine, bounded by filesystem writes.
- The zod 3 high advisory is still present. Its exposure is reduced by the new 1 MB request-body cap.
- Tool calls within one model round run sequentially, not in parallel.

Details are in [06](06-production-readiness.md) and [07](07-remaining-risks.md).

## Report index

| File                                                               | Content                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| [01-system-verification.md](01-system-verification.md)             | Subsystem inventory, what is implemented, how each was verified |
| [02-e2e-test-results.md](02-e2e-test-results.md)                   | Per-test records for workflows, HTTP/WS, MCP and scheduler      |
| [03-concurrency-performance.md](03-concurrency-performance.md)     | Load profiles, measurements, before/after the PR-18 fix         |
| [04-failure-injection.md](04-failure-injection.md)                 | Per-scenario failure results                                    |
| [05-regression-fixes.md](05-regression-fixes.md)                   | PR-01 … PR-18: reproduction, root cause, fix, regression test   |
| [06-production-readiness.md](06-production-readiness.md)           | Readiness classification per area, deployment conditions        |
| [07-remaining-risks.md](07-remaining-risks.md)                     | Open risks, carried-over remediation items, not-verified areas  |
| [08-final-verification-matrix.md](08-final-verification-matrix.md) | One matrix of every subsystem × verification type × status      |
