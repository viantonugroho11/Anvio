# 01 — System Verification: What Is Implemented and How It Was Checked

## Method

For each subsystem the question was: "does it run end to end in a booted platform?", not "does it have tests?". Every subsystem is classified by the strongest evidence collected in this phase:

| Evidence level   | Meaning                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2E-real**     | Exercised through a booted `createPlatform` with production code on the whole path. The model is scripted. Transports are real where noted: loopback HTTP/WS, a child process over stdio, the filesystem, restarts. |
| **Integration**  | Covered by existing `tests/integration/*.integration.spec.ts` with real package wiring. Re-run and passing in this phase.                                                                                           |
| **Unit**         | Only colocated `*.spec.ts`.                                                                                                                                                                                         |
| **Not verified** | Needs a live external service or infrastructure this phase did not have.                                                                                                                                            |

"Scripted model" means `ProgrammableProvider` (`tests/integration/e2e/harness.ts`). It is a `ModelProvider` that returns predetermined text, tool calls, errors or streams. These tests prove Anvio's orchestration. They prove **nothing** about any real provider's API compatibility.

## Subsystem inventory

### Apps

| App                        | State       | Evidence                                                                               | Notes                                              |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `gateway` (unified daemon) | Implemented | **E2E-real**: GW-01..07 over loopback HTTP and WebSocket against `startUnifiedGateway` | Fixed PR-04/05/06/07 here                          |
| `cli`                      | Implemented | Integration (`anvio.integration.spec.ts`, `boot.integration.spec.ts`)                  | Not driven interactively in this phase             |
| `worker`                   | Implemented | The worker logic (`registerGatewayWorker`) is on every E2E path                        | The detached worker process was not run separately |
| `api` (NestJS)             | Implemented | Unit and integration only                                                              | Not booted in this phase                           |
| `web` (Next.js)            | Implemented | Not verified                                                                           | UI out of scope                                    |
| `desktop`                  | Scaffold    | Not verified                                                                           | Early stage, per CLAUDE.md                         |

### Runtime engine

| Package              | Evidence                                             | What was shown                                                                                                                                                 |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents` (tool loop) | **E2E-real**                                         | Multi-round tool calls, streaming, stop and cancel, idle timeout, approval checkpoint and resume, delegation (E2E-01..10, FI-01/03/04, LOAD-03)                |
| `models`             | **E2E-real** (injection seam only)                   | The scripted provider goes through the platform's provider injection. Routing and fallback across real providers: **not verified**                             |
| `runtimes`           | **E2E-real** for `local`; integration for the others | `local` runtime on every E2E path. claude-code, cursor, codex, antigravity, ssh, daytona, modal and singularity: **not verified live**                         |
| `tools`              | **E2E-real**                                         | `http_request` against a real local server, plus `datetime_now`, `json_parse`, `file_read` with path-escape refusal, `delegate_task`, `skills_list`, `cronjob` |
| `memory`             | **E2E-real**                                         | Save → restart → recall (E2E-05); storage EACCES (FI-07). FTS5/Honcho: not verified                                                                            |

### Advanced Agent OS

| Package                                               | Evidence                                   | Notes                                                                              |
| ----------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `automation`                                          | **E2E-real**: SCH-01..06                   | Cron, timezone, restart dedupe, failure isolation, bad files. Fixed PR-08/09/10/11 |
| `skills`                                              | **E2E-real**: E2E-04, FI-06                | Composable YAML skill execution; broken skill error. Fixed PR-16                   |
| `souls`, `soul-gate`                                  | **E2E-real**: MCP-02/03                    | SOUL.md approvers and trusted channels gate MCP first use                          |
| `learning`                                            | Integration (`phase-l6-runtime-learning`)  | Fires at session end on E2E paths; outputs not asserted here                       |
| `goals`, `kanban`, `batch`, `workflows`, `blueprints` | Integration (`kanban`, `batch`, `phase-*`) | No new E2E                                                                         |
| `execution`                                           | Integration (`code-execution`)             | Sandboxed exec not re-tested under load                                            |
| `credentials`                                         | Integration (`credentials`, `connections`) | —                                                                                  |

### Connectivity

| Package                                               | Evidence                                                                                           | Notes                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `channels`                                            | **E2E-real** with `SimulatedChannel` (webchat and Slack profiles); integration for the P8 channels | Live Slack/Discord/Telegram/WhatsApp/etc.: **not verified**                                           |
| `harness`                                             | **E2E-real**                                                                                       | Engagement (mention/DM policy), approval routing, unauthorized approver refusal                       |
| `integrations` (MCP)                                  | **E2E-real**: MCP-01..05                                                                           | Official-SDK stdio server as a child process; approval; broken binary; shutdown. Fixed PR-02/03/12/17 |
| `a2a`, `acp`                                          | Integration (`a2a`, `acp`, over real HTTP)                                                         | Re-run, passing                                                                                       |
| `events`                                              | **E2E-real** (in-process bus)                                                                      | NATS JetStream mode: **not verified**                                                                 |
| `observability`                                       | **E2E-real** (logs)                                                                                | `runId`-tagged pino lines observed in failure runs                                                    |
| `workspace`                                           | **E2E-real**                                                                                       | Config fail-closed (PR-13), session thread index (PR-18), restart repair (PR-15)                      |
| `storage`                                             | **E2E-real** (filesystem)                                                                          | SQLite Level 2 under load: not verified                                                               |
| `auth`                                                | Unit and integration                                                                               | Off by default; JWT not exercised over HTTP in this phase                                             |
| `db` (Drizzle/PostgreSQL)                             | **Not verified**                                                                                   | Level 3+, no database in this environment                                                             |
| `voice`, `knowledge`, `personas`, `hooks`, `tool-bus` | Unit or integration                                                                                | `tool-bus` is unwired (CQ-024)                                                                        |

## Observations that are not defects

1. **The agent Markdown body is not the system prompt.** The system prompt comes from the agent's `persona`. The body only feeds the description. CLAUDE.md says the body is the system prompt. Either the docs or the loader should change; this is a product decision, so it was left alone. The E2E tests give agents their own persona (`personaMd` helper).
2. **Approver IDs in SOUL.md** are recognised only for the `slack:`, `telegram:`, `whatsapp:`, `discord:` and `cli:` prefixes. A `webchat:` user cannot be an approver.
3. **Tool calls in one model round run sequentially** (`packages/agents/src/tool-round.ts`, a `for` loop). This is correct, but a model that issues 10 independent calls waits for the sum of their latencies.
4. **The `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable is set in this machine's shell.** Node warned about it in the test runs. Anvio does not set it. `pnpm audit` was run with it unset. Operators should make sure it is not set in production.
