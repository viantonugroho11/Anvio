# 07 — Change Inventory

Working tree on branch `fix/code-quality-remediation`; **nothing committed or pushed.** Source diff excluding the lockfile: 85 files changed, +2 227 / −3 574 lines (the deletions are mostly the CLI moving out of `main.ts`), plus 39 new source/test files and 3 deleted files.

## Files created

**Source**
- `packages/core/src/fs-paths.ts`, `fs-atomic.ts`, `sandbox-env.ts`, `concurrency.ts`
- `packages/agents/src/tool-round.ts`
- `packages/tools/src/builtins/egress.ts`
- `packages/skills/src/condition-expression.ts`
- `packages/channels/src/reconnect.ts`
- `packages/memory/src/conversation-entries.ts`
- `packages/runtimes/src/exec-command.ts`
- `packages/platform/src/handlers/run-completed.ts`, `packages/platform/src/mock-model-provider.ts`
- `apps/cli/src/cli-context.ts`, `apps/cli/src/commands/{sessions,identity,planning,runtime,skills,gateway}.ts`

**Tests**
- `packages/auth/src/index.spec.ts`
- `packages/core/src/fs-paths.spec.ts`, `concurrency.spec.ts`
- `packages/storage/src/filesystem.spec.ts`
- `packages/tools/src/builtins/egress.spec.ts`, `packages/tools/src/gateway-load.spec.ts`
- `packages/execution/src/sandbox/process-sandbox.spec.ts`
- `packages/skills/src/condition-expression.spec.ts`, `executor.spec.ts`
- `packages/agents/src/runtime-lifecycle.spec.ts`, `orchestrator.spec.ts`
- `packages/channels/src/socket-lifecycle.spec.ts`, `telegram-dispatch.spec.ts`
- `packages/memory/src/conversation-entries.spec.ts`
- `packages/credentials/src/encrypted-store.spec.ts`
- `packages/platform/src/handlers/run-completed.spec.ts`, `process-guards.spec.ts`
- `packages/runtimes/src/exec-command.spec.ts`
- `tests/integration/session-serialization.integration.spec.ts`, `shutdown-signals.integration.spec.ts`

**Docs**
- `docs/audits/code-quality/remediation/00-…07-*.md`

## Files deleted

- `packages/agents/src/tool-loop.ts`, `packages/agents/src/native-tool-loop.ts` (replaced by `tool-round.ts`)
- `packages/tools/src/legacy.ts` (unused Postgres audit logger and stub executor)

## Files modified (source and config)

- **agents:** `runtime.ts`, `orchestrator.ts`, `run-checkpoint.ts`, `index.ts`, `package.json`
- **auth:** `index.ts`
- **core:** `index.ts`, `ports/agent-runtime.port.ts`, `ports/orchestration.port.ts`, `ports/runtime-tool.port.ts`, `schemas/tool-gateway.schema.ts`
- **tools:** `gateway.ts`, `index.ts`, `builtins/{index,filesystem,patch-file,workspace-tools,network-tools,web-fetch,web-extract,process-manager}.ts`, `package.json`, `tsconfig.json`
- **execution:** `sandbox/process-sandbox.ts`, `index.ts`
- **storage:** `filesystem.ts`, `jsonl.ts`
- **skills:** `executor.ts`, `catalog-resolver.ts`, `index.ts`
- **channels:** `slack.ts`, `discord.ts`, `telegram.ts`, `channel-session-bridge.ts`
- **harness:** `engagement.ts`
- **memory:** `filesystem-memory.ts`, `provider-factory.ts`, `index.ts`
- **models:** `circuit-breaker.ts`, `circuit-breaker.spec.ts`
- **credentials:** `encrypted-store.ts`
- **learning:** `skill-evolution.ts`, `skill-evolution.spec.ts`
- **runtimes:** `ssh/ssh-runtime.ts`, `singularity/singularity-runtime.ts`, `remote/remote-runtime-stub.ts`, `docker/docker-runtime.ts`, two specs (lint fixes), `package.json`
- **events:** `types.ts`
- **platform:** `index.ts`, `gateway-worker.ts`, `unified-gateway.ts`, `process-guards.ts`, `agent-run.ts`, `platform-context.ts`
- **tool-bus:** `policy.ts` (doc only)
- **observability:** `package.json`
- **apps:** `cli/src/main.ts`, `worker/src/main.ts`, `gateway/src/main.ts`, `api/src/main.ts`, `web/package.json`
- **lint scripts added:** `package.json` of `apps/{cli,gateway,worker}`, `packages/{a2a,acp,auth,credentials,execution,harness,integrations,knowledge,learning,platform,runtimes,soul-gate,storage,voice,workflows,workspace}`
- **repo:** `package.json` (overrides), `pnpm-lock.yaml`, `eslint.config.js`, `.github/workflows/ci.yml`

## Dependencies

| Change | Package |
|---|---|
| Upgraded | `next` ^15.5.28 (web); `@opentelemetry/api` ^1.10, `sdk-node` ^0.300, `exporter-trace-otlp-http` ^0.300, `auto-instrumentations-node` ^0.82, `resources` ^3 (observability); `zod` ^4.6.6 (runtimes) |
| Added (direct) | `@modelcontextprotocol/sdk` ^1.32.0 (runtimes); `zod` ^3.25.28 (agents) |
| Removed | `@anvio/db` from `@anvio/tools` |
| Overrides added/changed | `brace-expansion`, `multer`, `proxy-addr`, `source-map-js`, `qs`, `ip-address`, `body-parser`, `@modelcontextprotocol/sdk`, `zod@4` |

## Configuration changes

| Key / variable | Change |
|---|---|
| `tools/gateway.yaml` → `spec.network` | **new, optional**: `allowPrivateNetwork` (false), `allowHosts` ([]), `maxResponseBytes` (2 000 000) |
| `ANVIO_MODEL_IDLE_TIMEOUT_MS` | new (default 300 000; 0 disables) |
| `ANVIO_MAX_CONCURRENT_RUNS` | new (default 8) |
| `ANVIO_SANDBOX_ENV_PASSTHROUGH` | new (comma-separated env names passed to sandboxed code) |
| `JWT_SECRET` | now **required** when `auth.provider: jwt` |
| ESLint | `varsIgnorePattern`/`destructuredArrayIgnorePattern: ^_`, `prefer-const` `ignoreReadBeforeAssign` |
| CI | Node 22 for lint/build; test matrix 22 + 24; new `audit` job (`--audit-level=critical`) required by `all-green` |

## Public API changes

- **Additive:** stream `done.{provider,model,stopReason}`, `error.{code,retryable}`; `RuntimeToolContext.signal`; `ToolGatewayCallContext.signal`; `BuiltinToolContext.signal`; `HttpRequestInput.signal`; `OrchestrationTaskResult.status: 'awaiting_approval'`; `AgentRunCompletedData.{provider,model}`; new exports listed in `02` §6; `DefaultAgentRuntime.isRunning()`; `SkillNotFoundError`; `SkillStepError` codes `INVALID_CONDITION`, `SKILL_CYCLE`.
- **Removed exports:** `executeCode`, `PostgresToolAuditLogger`, `StubToolExecutor` from `@anvio/tools`; `export * from './orchestrator.js'` from `agents/src/runtime.ts` (package index unchanged).
- **Changed signatures (compatible):** `webFetch(url, maxChars?, policy?, signal?)`, `webExtract(url, maxChars?, policy?, signal?)`, `httpRequest(input, policy?)`, `exitOnShutdownSignals(label, fn, exitCodes?)`.

## Storage / persistence migrations

- None required. Formats unchanged: session files, credential blobs, engagement files, JSONL audits.
- New checkpoint version 2 (`agentRunCheckpoint.version: 2`); version 1 still read.
- Writes now go through temp files named `<file>.<pid>.<hex>.tmp`; stale ones from a crash may remain and are ignored by `list()`.
