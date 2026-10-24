# 08 — Final Verification Matrix

Legend:

- **P**: PASS
- **F→P**: failed, fixed, now passing
- **—**: not applicable
- **NR**: not run
- **NV**: not verifiable here (needs live service or infrastructure)

Columns:

- **E2E** = new suites in `tests/integration/e2e`
- **Int** = existing `tests/integration`
- **Unit** = colocated specs
- **Load** = LOAD-01..04
- **FI** = failure injection (FI-xx and the failure cases in the other suites)
- **Live** = against the real external service

| Subsystem                                   | E2E                | Int | Unit | Load          | FI  | Live                                                | Rating                                      | Defects        |
| ------------------------------------------- | ------------------ | --- | ---- | ------------- | --- | --------------------------------------------------- | ------------------------------------------- | -------------- |
| agents (tool loop)                          | P                  | P   | P    | P             | P   | —                                                   | READY                                       | —              |
| platform / delegation                       | F→P                | P   | F→P  | —             | P   | —                                                   | READY                                       | PR-01          |
| platform / cronjob tool                     | F→P                | —   | —    | —             | P   | —                                                   | READY                                       | PR-11          |
| gateway HTTP/WS                             | F→P                | P   | P    | —             | F→P | —                                                   | READY WITH CONDITIONS                       | PR-04/05/06/07 |
| gateway worker                              | F→P                | P   | P    | P             | F→P | —                                                   | READY WITH CONDITIONS                       | PR-14, PR-15   |
| workspace (config, sessions)                | F→P                | P   | F→P  | F→P           | F→P | —                                                   | READY                                       | PR-13, PR-18   |
| storage (filesystem)                        | P                  | P   | P    | P             | P   | —                                                   | READY WITH CONDITIONS                       | — (R-02)       |
| memory (filesystem)                         | P                  | P   | P    | P             | P   | —                                                   | READY                                       | —              |
| tools / builtins                            | P                  | P   | P    | —             | P   | —                                                   | READY                                       | —              |
| skills                                      | P                  | P   | F→P  | —             | F→P | —                                                   | READY                                       | PR-16          |
| automation / scheduler                      | F→P                | P   | F→P  | —             | F→P | —                                                   | READY                                       | PR-08/09/10    |
| integrations / MCP stdio                    | F→P                | P   | P    | —             | F→P | NV (third-party servers other than the SDK fixture) | READY WITH CONDITIONS                       | PR-02/03/12/17 |
| harness (engagement, approval)              | P                  | P   | P    | —             | P   | —                                                   | READY                                       | —              |
| souls / soul-gate                           | P                  | P   | P    | —             | P   | —                                                   | READY                                       | —              |
| channels                                    | P (simulated)      | P   | P    | P (simulated) | P   | NV                                                  | NOT VERIFIED (live)                         | —              |
| events (in-process)                         | P                  | P   | P    | P             | —   | —                                                   | READY                                       | —              |
| events (NATS)                               | NR                 | NR  | P    | NR            | NR  | NV                                                  | NOT VERIFIED                                | —              |
| models (routing/fallback)                   | P (injection seam) | P   | P    | —             | P   | NV                                                  | NOT VERIFIED (live)                         | —              |
| runtimes: local                             | P                  | P   | P    | P             | P   | —                                                   | READY                                       | —              |
| runtimes: vendor CLI / remote               | NR                 | P   | P    | NR            | NR  | NV                                                  | NOT VERIFIED                                | —              |
| a2a                                         | NR                 | P   | P    | NR            | NR  | —                                                   | READY WITH CONDITIONS (existing tests only) | —              |
| acp                                         | NR                 | P   | P    | NR            | NR  | NV                                                  | READY WITH CONDITIONS (existing tests only) | —              |
| observability                               | P (logs)           | P   | P    | —             | P   | —                                                   | READY WITH CONDITIONS (CQ-018)              | —              |
| learning                                    | P (fires)          | P   | P    | —             | —   | —                                                   | READY WITH CONDITIONS                       | —              |
| goals, kanban, batch, workflows, blueprints | NR                 | P   | P    | NR            | NR  | —                                                   | READY WITH CONDITIONS (existing tests only) | —              |
| execution (sandbox)                         | NR                 | P   | P    | NR            | NR  | —                                                   | READY WITH CONDITIONS                       | —              |
| credentials                                 | NR                 | P   | P    | NR            | NR  | —                                                   | READY WITH CONDITIONS                       | —              |
| auth (JWT)                                  | NR                 | P   | P    | NR            | NR  | —                                                   | NOT VERIFIED over HTTP                      | —              |
| db (PostgreSQL, Level 3)                    | NR                 | NR  | P    | NR            | NR  | NV                                                  | NOT VERIFIED                                | —              |
| voice, knowledge, personas, hooks           | NR                 | P   | P    | NR            | NR  | NV                                                  | READY WITH CONDITIONS (existing tests only) | —              |
| tool-bus                                    | NR                 | NR  | P    | NR            | NR  | —                                                   | Unwired (CQ-024)                            | —              |
| apps/cli                                    | NR                 | P   | P    | —             | —   | —                                                   | READY WITH CONDITIONS                       | —              |
| apps/api, apps/web, apps/desktop            | NR                 | —   | P    | NR            | NR  | —                                                   | NOT VERIFIED                                | —              |

## Gate results (final run)

| Gate               | Command                                    | Result                                                                  |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| Build              | `pnpm build`                               | PASS (40/40)                                                            |
| Typecheck          | `pnpm typecheck`                           | PASS (73/73)                                                            |
| Lint               | `pnpm lint`                                | PASS (73/73)                                                            |
| Unit + integration | `ANTHROPIC_API_KEY=test-key pnpm test`     | PASS: 178 files, 1 014 tests                                            |
| Integration only   | `pnpm test:integration`                    | PASS: 42 files, 203 tests                                               |
| New E2E, ×3        | `npx vitest run tests/integration/e2e`     | PASS 43/43 on each run                                                  |
| Audit (CI gate)    | `pnpm audit --prod --audit-level=critical` | PASS                                                                    |
| Audit (all)        | `pnpm audit --prod`                        | 1 high (zod 3, CQ-016), 2 moderate, 2 low                               |
| Format             | `pnpm format:check`                        | FAIL: 382 pre-existing files (CQ-017); files changed here are formatted |

## Completion gate

- Every subsystem evaluated: **yes** (table above; NOT VERIFIED where a live service is required).
- Lint, typecheck, build and tests executed: **yes**, all passing.
- Defects found in this phase: 18, all fixed and covered by tests. PR-12 is covered indirectly (R-09).
