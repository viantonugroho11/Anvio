# 02 — E2E Test Results

All tests live in `tests/integration/e2e/`. Each boots the real platform from a temporary copy of the repo's sample `workspace/`. **Model: scripted** in every test. "Transport" says what is real beyond in-process calls.

Run: `ANTHROPIC_API_KEY=test-key npx vitest run tests/integration/e2e`. The suite passed 3 times in a row (43/43 each time). Before running it, run `pnpm build`: tests import the packages' `dist/`.

Columns: ID · subsystem · scenario · expected · actual · status · evidence · fix reference.

## Workflows: `workflows.e2e.integration.spec.ts`

| ID     | Subsystem               | Scenario                                                         | Expected                                                          | Actual                                                    | Status         | Evidence                                | Fix                                                        |
| ------ | ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | -------------- | --------------------------------------- | ---------------------------------------------------------- |
| E2E-01 | agents, worker, storage | User message → agent → LLM → reply                               | Reply delivered; session stores both messages; status `completed` | As expected                                               | PASS           | assertions on outbox and stored session | —                                                          |
| E2E-02 | tools (`http_request`)  | Tool call against a real local HTTP server                       | Model sees the tool result; server hit once; 2 model calls        | As expected                                               | PASS           | `hits` contains `GET /weather`          | —                                                          |
| E2E-03 | agents tool loop        | 2 tools in one round + 1 in the next round                       | Model receives 3 tool results; `file_read` content correct        | As expected                                               | PASS           | —                                       | —                                                          |
| E2E-04 | skills                  | `skills_list` → composable YAML skill → conditional step skipped | Step outputs JSON returned; `now` step absent                     | As expected                                               | PASS           | —                                       | Fixture needed `composable: true` (test fix, not a defect) |
| E2E-05 | memory, workspace       | Save → **platform restart on same dir** → recall                 | Same session resumed; history visible to the model                | As expected                                               | PASS           | —                                       | —                                                          |
| E2E-06 | worker, events          | Provider 503 → user notified → next message recovers             | `AGENT_RUN_FAILED` ×1; next turn `completed`                      | As expected                                               | PASS           | —                                       | —                                                          |
| E2E-07 | tools                   | Tool timeout (200 ms on a 3 s endpoint)                          | Tool fails; model answers; turn under 2.5 s                       | As expected                                               | PASS           | —                                       | —                                                          |
| E2E-08 | channels, harness       | Two threads, two users                                           | Separate sessions; no history bleed                               | As expected                                               | PASS           | `history=1` on thread B                 | —                                                          |
| E2E-09 | agents (cancellation)   | Stop during streaming                                            | Stream ends in under 2 s; session reusable                        | As expected                                               | PASS           | —                                       | —                                                          |
| E2E-10 | platform (delegation)   | Manager delegates to researcher; result aggregated               | Sub-agent session exists; manager summarises                      | **Initially hung**: unbounded recursion (3 000+ sessions) | PASS after fix | —                                       | **PR-01**                                                  |

## Gateway over real HTTP and WebSocket: `gateway-http.e2e.integration.spec.ts`

Transport: `startUnifiedGateway({ port: 0, host: '127.0.0.1' })`, real `fetch` and `WebSocket`.

| ID    | Subsystem       | Scenario                                           | Expected                                | Actual                                          | Status         | Fix       |
| ----- | --------------- | -------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | -------------- | --------- |
| GW-01 | gateway         | `GET /health`                                      | 200 `{status: ok, auth: false}`         | As expected                                     | PASS           | —         |
| GW-02 | gateway, worker | Create session → POST message (model takes 800 ms) | 202 in under 500 ms; reply stored later | **Initially 202 after the full turn**           | PASS after fix | **PR-04** |
| GW-03 | gateway WS      | WS message → chunk → done                          | Chunk and done frames carry the reply   | As expected                                     | PASS           | —         |
| GW-04 | gateway         | Malformed JSON body                                | 400                                     | **Initially hung, plus an unhandled rejection** | PASS after fix | **PR-05** |
| GW-05 | gateway         | 2 MB body                                          | 413                                     | **Initially accepted with no limit**            | PASS after fix | **PR-06** |
| GW-06 | gateway         | Unknown agent / route / missing content            | 404 / 404 / 400                         | **Missing content was accepted**                | PASS after fix | **PR-07** |
| GW-07 | gateway WS      | Invalid frame                                      | Error frame; socket stays open          | As expected                                     | PASS           | —         |

## MCP with an official-SDK server over stdio: `mcp-approval.e2e.integration.spec.ts`

Transport: child process `node fixtures/official-mcp-server.mjs`, built on `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`.

| ID     | Subsystem                    | Scenario                                                                  | Expected                                                | Actual                                    | Status         | Fix       |
| ------ | ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- | -------------- | --------- |
| MCP-01 | integrations                 | `McpStdioClient` lists and calls tools                                    | `['add','whoami']`; `add(2,40)` returns `42`            | **Initially timed out: framing mismatch** | PASS after fix | **PR-02** |
| MCP-02 | integrations, harness, souls | Agent → MCP tool → first-use approval → approve (Slack approver) → resume | Approval card shown; resolved; answer `42`; `completed` | As expected (after PR-02)                 | PASS           | —         |
| MCP-03 | harness                      | Approval rejected                                                         | MCP tool not executed; model told it was denied         | As expected                               | PASS           | —         |
| MCP-04 | integrations                 | Configured binary does not exist                                          | Platform boots and answers                              | **Initially an unhandled `spawn ENOENT`** | PASS after fix | **PR-03** |
| MCP-05 | platform shutdown            | MCP server process after `platform.shutdown()`                            | Process gone within 3 s                                 | **Initially still running**               | PASS after fix | **PR-17** |

## Scheduler: `scheduler.e2e.integration.spec.ts`

| ID     | Subsystem               | Scenario                                                               | Expected                                                                    | Actual                               | Status         | Fix       |
| ------ | ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ | -------------- | --------- |
| SCH-01 | automation              | Manual run                                                             | Agent receives input; `AUTOMATION_COMPLETED`                                | As expected                          | PASS           | —         |
| SCH-02 | automation, state       | Fires once per minute; **restart** in the same minute does not re-fire | `[slug]`, `[]`, `[]` after restart, `[slug]` next minute                    | As expected                          | PASS           | —         |
| SCH-03 | automation              | One automation fails in a tick                                         | The others still run; failure event for the failing one                     | **Initially the whole tick aborted** | PASS after fix | **PR-09** |
| SCH-04 | automation              | Malformed automation file                                              | Boot succeeds; valid automations fire                                       | **Initially boot failed**            | PASS after fix | **PR-10** |
| SCH-05 | automation              | `timezone: Asia/Jakarta`                                               | 09:00 Jakarta = 02:00 UTC fires; 09:00 UTC does not                         | **Initially timezone was ignored**   | PASS after fix | **PR-08** |
| SCH-06 | platform `cronjob` tool | Model-supplied prompt containing YAML; `../escape` slug; invalid cron  | Prompt stored verbatim as data; trigger untouched; the other 2 creates fail | As expected (after the fix)          | PASS           | **PR-11** |

## Load and failure suites

See [03-concurrency-performance.md](03-concurrency-performance.md) (LOAD-01..04) and [04-failure-injection.md](04-failure-injection.md) (FI-01..11).

## Live vs mocked

| Real in these tests                                                                                                                                                                              | Scripted or simulated                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| HTTP server and client, WebSocket, child processes (MCP), filesystem, process restarts, timers and cancellation, event bus (in-process), tool gateway and builtins, YAML/Markdown config loading | LLM provider (`ProgrammableProvider`); chat channel (`SimulatedChannel` impersonating webchat or Slack profiles) |

No test in this phase talked to Anthropic, OpenAI, DeepSeek or any other provider, nor to Slack, Discord, Telegram or any other chat service. The existing integration suites do not either.
