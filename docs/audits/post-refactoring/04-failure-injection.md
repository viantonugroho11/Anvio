# 04 — Failure Injection

Spec: `tests/integration/e2e/failure-injection.e2e.integration.spec.ts`. Related failure cases in the other suites: GW-04/05/06/07, MCP-03/04/05, SCH-03/04, LOAD-03/04.

Each case checks three properties:

- **contained**: the process and other sessions keep working;
- **observable**: there is an event or a notice the user can see;
- **recoverable**: where that makes sense, the next turn works.

| ID    | Injected failure                                                                       | Expected                                                                                                    | Actual                                                                                                       | Status         | Evidence                                              | Fix                                                             |
| ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| FI-01 | LLM never responds (stream sleeps 60 s) with `ANVIO_MODEL_IDLE_TIMEOUT_MS=200`         | Turn fails in under 3 s with "did not respond"; next turn works                                             | As expected                                                                                                  | PASS           | `AGENT_RUN_FAILED` error text                         | —                                                               |
| FI-02 | Provider returns `HTTP 429` (retryable) for one user                                   | That session fails with the 429 text; another session is unaffected                                         | As expected                                                                                                  | PASS           | —                                                     | —                                                               |
| FI-03 | Unknown tool, bad JSON argument, `../../etc/passwd` path                               | All three reported to the model as failed; turn completes                                                   | `failures=3`                                                                                                 | PASS           | path escape refused by `file_read`                    | —                                                               |
| FI-04 | Tool whose handler throws (`delegate_task` to a missing agent)                         | Model sees a failed tool result; turn completes                                                             | As expected                                                                                                  | PASS           | —                                                     | —                                                               |
| FI-05 | Connection refused (`127.0.0.1:9`)                                                     | Tool fails; model recovers                                                                                  | As expected                                                                                                  | PASS           | —                                                     | —                                                               |
| FI-06 | Skill YAML that does not parse, referenced by the agent                                | Run fails visibly **with the real cause**                                                                   | **Initially "Skill not found: broken"** (parse error hidden). Now `Skill broken is invalid: Flow sequence …` | PASS after fix | `AGENT_RUN_FAILED` error                              | **PR-16**. The test also subscribed too late; fixed in the test |
| FI-07 | `memory/sessions` made read-only (EACCES)                                              | Turn fails visibly; process survives; recovers once writable                                                | 1 failure event; next turn `stored?`                                                                         | PASS           | warn log "could not save history for unfinished turn" | —                                                               |
| FI-08 | Channel `sendMessage` throws on the final reply                                        | Run still completes and is persisted                                                                        | Stored last message is the reply; error logged with `runId`                                                  | PASS           | pino `reply delivery failed`                          | —                                                               |
| FI-09 | Platform torn down mid-turn (simulated crash), then booted again on the same workspace | Interrupted session repaired; user can continue                                                             | **Initially stayed `calling_model` forever**                                                                 | PASS after fix | `metadata.interruptedAt` set                          | **PR-15**                                                       |
| FI-10 | `anvio.yaml` replaced with invalid YAML                                                | `createPlatform` rejects with a clear error                                                                 | **Initially booted with defaults (auth off)**                                                                | PASS after fix | `Invalid workspace config …/anvio.yaml: …`            | **PR-13**                                                       |
| FI-11 | Agent file with broken frontmatter receives a run                                      | Session `failed`; failure event `Agent broken could not be loaded`; "Task Failed" notice; other agents fine | **Initially the worker threw before the run**: no event, no notice, session stuck                            | PASS after fix | outbox contains the Task Failed notice                | **PR-14**                                                       |

## Failure cases in other suites

| ID      | Failure                             | Result                                          | Fix       |
| ------- | ----------------------------------- | ----------------------------------------------- | --------- |
| GW-04   | Malformed JSON over HTTP            | 400                                             | PR-05     |
| GW-05   | 2 MB body                           | 413                                             | PR-06     |
| GW-07   | Garbage WebSocket frame             | Error frame; socket stays open                  | —         |
| MCP-03  | Approval rejected                   | Tool not executed                               | —         |
| MCP-04  | MCP binary missing                  | Boot and answer unaffected                      | PR-03     |
| MCP-05  | Shutdown with an MCP server running | Child process terminated                        | PR-17     |
| SCH-03  | One automation's agent is missing   | The others in the tick still run                | PR-09     |
| SCH-04  | Malformed automation file           | Skipped and logged; boot continues              | PR-10     |
| LOAD-03 | Mass cancellation under load        | Settles in about 400 ms                         | —         |
| LOAD-04 | Shutdown under load + restart       | Running sessions repaired; queued messages lost | Risk R-01 |

## Not injected

- Disk full (ENOSPC) during an atomic write. Covered at unit level by `fs-atomic` behaviour only.
- Clock jumps and DST transitions while the scheduler is running. Timezone evaluation itself is covered (SCH-05, `cron-parser.spec.ts`).
- Partial network failures to live providers: TLS errors, slow-loris, mid-stream disconnect from a real SSE endpoint.
- Corrupted session JSON on disk. `readJson` behaviour was not exercised under corruption in this phase.
- NATS or PostgreSQL outages (Level 3).
