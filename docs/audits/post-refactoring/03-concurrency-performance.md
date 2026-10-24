# 03 — Concurrency and Performance

## Setup

- **Spec:** `tests/integration/e2e/load.e2e.integration.spec.ts`. It is repeatable. Profiles are set by environment variables:
  ```bash
  ANTHROPIC_API_KEY=test-key ANVIO_LOAD_SESSIONS=200 ANVIO_LOAD_TURNS=5 ANVIO_LOAD_CAP=16 \
    ANVIO_LOAD_LATENCY_MS=50 ANVIO_LOAD_REPORT=/tmp/load.json \
    npx vitest run tests/integration/e2e/load.e2e.integration.spec.ts -t LOAD-01
  ```
- **Machine:** Apple Silicon (darwin-arm64), Node v24.21.0. Single process. Level 1 filesystem storage in a temp directory on the internal SSD.
- **Model:** scripted, with a fixed sleep (`LATENCY_MS`) per call. **The numbers measure Anvio's own overhead and scheduling, not any real LLM.** Real providers add 0.5–30 s per call, so in production the provider, not Anvio, dominates latency.
- **Load shape:** closed loop. `SESSIONS` simulated users start at the same instant. Each sends `TURNS` messages one after another and waits for each reply. Latency is measured from just before `say()` to the reply in the outbox, so it **includes the wait for a concurrency slot**.
- **Assertions** concern correctness only: every reply is right, every session history is exact and in order, there are zero failures, peak concurrent model calls never exceed the cap, and no handle is left after shutdown. Timings are recorded, not asserted.
- **Event-loop delay** is sampled with `monitorEventLoopDelay({ resolution: 10 })`, so about 10 ms is the floor of the measurement. Values near 10 ms mean "no measurable blocking".

## LOAD-01: N sessions × M turns (after all fixes)

| Profile (sessions × turns, cap, latency) | Turns | Wall   | Throughput | p50      | p95   | p99   | max   | Errors | Peak model calls | Loop delay p99 / max | CPU user / sys | RSS before → after | Handles left |
| ---------------------------------------- | ----- | ------ | ---------- | -------- | ----- | ----- | ----- | ------ | ---------------- | -------------------- | -------------- | ------------------ | ------------ |
| 40×3, cap 8, 50 ms                       | 120   | 1.28 s | 94.1/s     | 407 ms   | 438   | 439   | 440   | 0      | 8                | 12.6 / 12.9 ms       | 0.58 / 1.02 s  | 222 → 290 MB       | none         |
| 200×5, cap 16, 50 ms                     | 1 000 | 10.0 s | 99.9/s     | 1 983 ms | 2 207 | 2 229 | 2 238 | 0      | 16               | 12.8 / 16.5 ms       | 6.2 / 16.0 s   | 228 → 375 MB       | none         |
| 500×2, cap 32, 50 ms                     | 1 000 | 11.1 s | 89.9/s     | 4 353 ms | 6 653 | 6 803 | 6 812 | 0      | 32               | 12.8 / 15.5 ms       | 8.1 / 25.1 s   | 222 → 364 MB       | none         |
| 100×3, cap 8, 0 ms                       | 300   | 1.47 s | 203.5/s    | 464 ms   | 524   | 532   | 535   | 0      | 1                | 12.3 / 14.0 ms       | 1.4 / 3.1 s    | 219 → 315 MB       | none         |
| 50×4, cap 8, 200 ms                      | 200   | 6.35 s | 31.5/s     | 1 522 ms | 1 779 | 1 788 | 1 795 | 0      | 8                | 13.4 / 17.6 ms       | 1.4 / 2.6 s    | 219 → 305 MB       | none         |

### Reading the numbers

- **The concurrency cap holds exactly.** Peak concurrent model calls equal `ANVIO_MAX_CONCURRENT_RUNS` in every profile where latency is above zero.
- **There is a throughput ceiling of roughly 90–100 turns/s** with 50 ms model latency, whatever the cap. A cap of 8 would allow 160 turns/s in theory, 16 would allow 320 and 32 would allow 640. At 200 ms latency, 79 % of the theoretical 40/s is reached. With zero latency, peak concurrency is 1: turns are CPU- and I/O-bound at about 5 ms each (around 200/s).
- **Time is mostly system CPU** (sys about 2.5× user). That points at filesystem syscalls: every turn rewrites the session JSON several times (status changes and the final history) through `writeFileAtomic`, and writes memory files. This is the Level 1 storage tier working as designed. It is not a blocking bug, but it is the capacity limit of Level 1 on this machine.
- **No event-loop blocking.** p99 delay stays within about 3 ms of the 10 ms sampling floor at every load, and the worst single stall was 17.8 ms.
- **Memory** grows 70–150 MB over 1 000 turns and stays flat across profiles, so no unbounded growth showed up. Heap after the run was 95–132 MB. A longer soak test (hours) was **not** run.
- **No leaked resources.** `process.getActiveResourcesInfo()` after `platform.shutdown()` showed no growth against the pre-boot baseline in any profile.

**No production capacity figure is claimed.** Real capacity depends on provider latency and rate limits, the storage tier and disk. Operators should rerun the spec with their own latency and cap values, or better, against Level 2 (SQLite).

## Before and after PR-18 (session lookup by thread)

The filesystem `getByChannelThread` read every session file for every inbound message. PR-18 added a verified in-memory thread index.

| Profile       | Before: throughput / p50 / p99 / sys CPU / RSS after | After                                                                       |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| 40×3, cap 8   | 95.9/s / 405 / 431 ms / 1.13 s / 290 MB              | 94.1/s / 407 / 439 ms / 1.02 s / 290 MB (no change at small N, as expected) |
| 200×5, cap 16 | 85.6/s / 2 448 / 2 700 ms / 23.9 s / 436 MB          | **99.9/s / 1 983 / 2 229 ms / 16.0 s / 375 MB**                             |
| 500×2, cap 32 | 69.6/s / 6 968 / 8 436 ms / 39.0 s / 520 MB          | **89.9/s / 4 353 / 6 803 ms / 25.1 s / 364 MB**                             |
| 100×3, 0 ms   | 168.1/s / 571 / 708 ms / 4.3 s                       | **203.5/s / 464 / 532 ms / 3.1 s**                                          |

Before the fix, throughput _fell_ as the number of stored sessions grew (96 → 86 → 70 turns/s). After it, throughput is flat (94 → 100 → 90). One cost remains: the **first** message of a never-seen thread still scans, because another process may have created that session. Long-lived threads, the normal case, are now O(1).

## LOAD-02 … LOAD-04: concurrency behaviour

| ID      | Scenario                                                               | Expected                                                                       | Actual                                                                                                                                                                                                                             | Status                                                               |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| LOAD-02 | 10 messages fired at the same session at once                          | Turns serialised (peak 1), all 10 stored, each answer right after its question | 20 messages stored, peak 1, no interleaving                                                                                                                                                                                        | PASS                                                                 |
| LOAD-03 | 20 in-flight streams; stop 10 of them                                  | The 10 stopped end quickly; the other 10 complete                              | 10 `failed`, 10 `completed`; everything settled 330–430 ms after the stop; 0 active model calls left                                                                                                                               | PASS                                                                 |
| LOAD-04 | Shutdown with 10 turns sent (cap 8: 8 running, 2 queued), then restart | Shutdown returns; after restart nothing is stuck "in progress"                 | Shutdown returned in under 1 ms; **8 model calls still running after shutdown**; on restart 8 sessions were repaired to `failed` with `interruptedAt`; **2 queued sessions stayed `idle` and their messages were never processed** | PASS (on the asserted contract). Behaviour recorded as risk **R-01** |

## Not covered

- Soak tests (hours or days), memory growth over a long uptime.
- Level 2 (SQLite) and Level 3 (PostgreSQL + NATS) under load.
- Multi-process deployments (separate gateway and worker processes sharing one workspace).
- Real provider rate-limit behaviour under load. FI-02 covers a single 429.
