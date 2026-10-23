# 11 — Verification Results

Environment: macOS (Darwin 25.6.0, arm64), Node **v24.21.0**, pnpm 9.15.9. CI uses Node 20 — results below are on Node 24 and may differ there. Working directory: repo root, branch `docs/audit-phase-3-a2a-plugins` @ `156c526`. Scripts were inspected before running: `build`/`typecheck`/`lint` write only to gitignored `dist/` and `.turbo/`; `test` uses temp workspaces and scripted providers (CI sets `ANTHROPIC_API_KEY=test-key`; same value used here so no real provider is called). No migrations, no `db:*`, no installs, no lockfile changes.

## Commands executed

| # | Command | Result | Notes |
|---|---|---|---|
| 1 | `pnpm build` | **PASS** (exit 0) | 40/40 turbo tasks, 33 cached, 6.2 s |
| 2 | `pnpm typecheck` | **PASS** (exit 0) | 74/74 tasks, 0 TS errors |
| 3 | `pnpm lint` | **PASS** (exit 0) — **partial coverage** | 55/55 tasks; ~20 of 40 packages define no `lint` script so are never linted (CQ-017) |
| 4 | `ANTHROPIC_API_KEY=test-key pnpm test` | **PASS** (exit 0) | 148 test files, **800 tests passed**, 15.1 s (unit + `tests/integration`) |
| 5 | `pnpm audit --prod` (+ `--json` for extraction) | **FAIL** (exit 1) | 32 advisories: 2 critical, 12 high, 17 moderate, 1 low (CQ-016; table in 07 §4) |
| 6 | `pnpm format:check` | **FAIL** (exit 1) | Prettier: 388 files with style issues (not in CI) |
| 7 | `git status --short` after all runs | clean (0 entries) | confirms no tracked file modified by checks |
| 8 | Workspace dependency-graph DFS (inline `node -e` over package.json files) | **PASS** — no package cycles | fan-in/fan-out numbers in 01 §3 |
| 9 | grep-based metrics (non-spec `apps/*/src`, `packages/*/src`) | recorded | `console.*` 384 · `catch {` 149 · `void fn(` 21 · `any` 7 · `as unknown as` 8 · sync fs/child 15 · `eslint-disable` 2 · TODO/FIXME 10 · `new Function` 2 |
| 10 | Importer counts per package (grep `from '@anvio/<pkg>'`) | recorded | `tool-bus` 0 importers (CQ-024) |

## Checks not executed

| Check | Status | Reason |
|---|---|---|
| File-level circular dependency detection (madge/dpdm) | **NOT VERIFIED** | Tool not installed; installing deps needs approval |
| Duplicate-code detection (jscpd) | **NOT VERIFIED** | Not installed; duplication findings are from manual reading |
| Cyclomatic/cognitive complexity metrics | **NOT VERIFIED** | No tool installed; complexity assessed by reading + line spans |
| Test coverage % | **NOT MEASURED** | No coverage provider configured (`@vitest/coverage-v8` absent) |
| Unused deps (depcheck/knip) | **NOT VERIFIED** | Not installed |
| `pnpm test:integration` separately | Covered by #4 | root vitest include already runs `tests/integration` |
| Tests on Node 20 (CI runtime) | **NOT VERIFIED** | Local Node is 24; global `WebSocket` reliance unverified on 20 (CQ-029) |
| Live channel/provider behaviour (Slack, Discord, Telegram, real LLMs) | **NOT VERIFIED** | Would contact external systems |
| Exploit validation of security findings | **NOT EXECUTED** | Audit-only; findings derived from code |
| `docker/docker-compose.dev.yml` / Level 3 (Postgres, NATS) paths | **NOT VERIFIED** | Requires starting infrastructure |
| `apps/web` lint (`next lint`) output review | Ran as part of #3 | not reviewed in detail |

## Coverage of manual inspection

| Area | Status |
|---|---|
| `agents` (runtime, tool loops, checkpoint, orchestrator) | Inspected (full read) |
| `models` router / fallback / breaker | Inspected; provider adapters scanned (signal/timeout) |
| `tools` gateway, network/fs/exec builtins, dispatch switch | Inspected (key cases); other ~60 builtins not read |
| `platform` index, gateway-worker, unified-gateway, process-guards, pending-mutations | Partially inspected (targeted sections) |
| `platform/slash-commands-extras.ts` | Structure only |
| `channels` base, hub, Discord, Slack, Telegram poll loop, create-channels inbound | Inspected (targeted); other 11 adapters not read |
| `harness` runtime-tool-port, approval producer | Inspected (targeted) |
| `memory`, `storage`, `auth`, `credentials` encryption, `execution` sandbox | Inspected |
| `skills` executor (composable + conditions) | Inspected (targeted) |
| `learning` gate | Inspected (targeted) |
| `events` local bus | Inspected |
| `runtimes` | ssh/singularity scanned; vendor runtimes (claude-code, cursor, codex, antigravity) **not inspected** |
| `integrations` (MCP) | approval path inspected; stdio client scanned |
| `a2a`, `acp`, `automation`, `hooks`, `goals`, `kanban`, `batch`, `blueprints`, `workflows`, `knowledge`, `voice`, `souls`, `soul-gate`, `personas`, `db` | **Not inspected** beyond dependency/importer scans |
| `apps/api` (NestJS), `apps/web` | **Not inspected** beyond size and audit output |
| `apps/cli` | Structure + targeted sections (shutdown, tools, remote exec) |

## Verification gaps that affect conclusions

- CQ-007 impact (latency/ordering) is inferred from the call chain, not load-tested → MEDIUM confidence.
- CQ-008 Slack URL functional status not tested against Slack.
- CQ-016 exploitability not triaged.
- Scores in `00` for areas marked "not inspected" are not extrapolated; see per-category limitations there.

## Final quality gate (self-check)

| Gate | Result |
|---|---|
| All major active components inspected | Core agent path yes; feature subsystems listed above not inspected — stated explicitly |
| Every finding references real code | Yes — file:line verified during audit; two claims corrected after re-check (`new Function` usages added as CQ-033/034) |
| Findings not duplicated across reports | Evidence lives in 09; topic reports reference IDs |
| Severity proportional | Only one CRITICAL (auth bypass); style items ≤ LOW |
| Recommendations address root causes | Yes (e.g. CQ-004 fixed by checkpoint content, not by retry suppression) |
| Compatibility preserved | Breaking changes flagged (P0-1, P0-2, P0-3, P1-3) |
| Abstractions justified | Only small helpers proposed; no new architectural layers |
| Scoring matches evidence | See 00; NOT ASSESSED where evidence insufficient |
| Roadmap covers all HIGH/CRITICAL | Yes (10 §Coverage check) |
| Untested assumptions labelled | MEDIUM/LOW confidence + NOT VERIFIED markers |
| No source code modified | Yes — only `docs/audits/code-quality/*.md` created; `git status` clean before writing reports |
