# 02 — Code Readability & Writing Standards

Scope: full read of `agents/src/*`, `tools/src/gateway.ts`, `models/src/{fallback-chain,circuit-breaker}.ts`, `storage/src/filesystem.ts`, `channels/src/{base-channel-adapter,discord,slack,telegram(poll loop),channel-hub}.ts`, `execution/src/sandbox/process-sandbox.ts`, `auth/src/index.ts`, `skills/src/executor.ts` (composable path), `memory/src/{filesystem-memory,provider-factory}.ts`; structural scans (grep/line counts) of `platform`, `apps/cli`, `slash-commands-extras`. Other packages were sampled, not read line by line.

## 1. Naming

**Strengths**
- Domain vocabulary is consistent where it matters: `session`, `agent`, `skill`, `soul`, `persona`, `channel`, `tool` mean the same thing across `core` schemas, runtime and docs.
- Tool names are namespaced by origin (`anvio_tools__`, `anvio_mcp__`, `anvio_channel__`, `skill__`), which makes routing in `HarnessAwareToolPort.call` (`harness/src/runtime-tool-port.ts:79-97`) self-explanatory.
- Error/notice constants are named for intent (`TRUNCATED_FINISH_REASONS`, `interruptedNotice`).

**Weaknesses**
- "Gateway" is overloaded: `ToolGateway` (tools), `HarnessGateway` (harness), unified gateway daemon (platform), `gateway-worker`, `gateway-http`, and `apps/gateway`. New engineers cannot tell from the name which layer a "gateway" bug lives in.
- "Runtime" also means two things: the agent loop (`DefaultAgentRuntime`) and execution backends (`packages/runtimes`). `RuntimeRoutingAgentRuntime` sits on both.
- Phase/epic code names leak into identifiers and test names (`phase-p11a.integration.spec.ts`, "Epic 12 F2 slice", "audit T-020", "Hermes GatewayRunner equivalent"). They encode project history, not behaviour; a test file name like `phase-p13` says nothing about what breaks when it fails.
- `iterationContent` vs `lastIterationContent` vs `fullContent` in `runtime.ts:208-209,228` require reading the whole loop to know which is user-visible.

## 2. Function design and complexity

| Function | Location | Size | Problem (not just length) |
|---|---|---:|---|
| `DefaultAgentRuntime.stream` | `agents/src/runtime.ts:114-406` | ~290 lines, async generator | Mixes prompt assembly, tool-port construction, provider routing, model streaming, two tool-loop variants, approval checkpointing, memory persistence and error mapping. Five distinct `return`/`break` exit paths with different persistence semantics. This is where CQ-004/005/006 hide. |
| `createPlatform` | `platform/src/index.ts:136-~949` | ~810 lines | Constructs every subsystem *and* defines event handlers inline as closures over 50+ locals (CQ-011). |
| `registerPlatformExtras` | `platform/src/slash-commands-extras.ts:121-1399` | ~1280 lines | 47 slash commands defined as closures in one function; no per-command unit test possible. |
| `main` + 42 `cmd*` | `apps/cli/src/main.ts` | 2 883 lines, 1 file | Argument parsing, help text, subsystem construction and output formatting in one file. |
| `SupervisorOrchestrator.execute` | `agents/src/orchestrator.ts:39-208` | ~170 lines | Closure `runSingleTask` mutates six shared collections (`results`, `outputs`, `completed`, `failed`, `skipped`, `aborted`); ordering of mutations is the correctness argument. |

**Concrete example — progress duplication noise** (`runtime.ts:218-226`):

```ts
yield { type: 'progress' as const, phase: iteration === startIteration ? 'Calling model' : 'Calling model after tools', status: 'running' as const };
this.deps.onProgress?.(session.id, iteration === startIteration ? 'Calling model' : 'Calling model after tools');
```

The same expression is computed twice and every phase is emitted on two channels (CQ-020). After:

```ts
const phase = iteration === startIteration ? 'Calling model' : 'Calling model after tools';
yield progress(phase);           // single emission path; onProgress removed
```

**Recommended decomposition of `stream` (behaviour-preserving)** — extract, in this order, each as a private method with explicit inputs/outputs:
1. `prepareTurn(session, agent, input)` → `{ systemPrompt, toolPort, modelProvider, requestModel, nativeTools, messages, startIteration, usage }` (lines 123-207).
2. `streamModelIteration(...)` → async generator yielding chunks and returning `{ content, toolCalls, interrupted }` (lines 228-294).
3. `runToolRound(...)` → `{ toolMessages, pendingApproval }` unifying both loops (lines 309-371, CQ-025).
4. `persistTurn(...)` (lines 378-383 + `finally`).

The loop body then reads as the state machine it is. This is justified by the real defects found in the current shape, not by line count.

## 3. Duplication

- `approvalSummaryFromResult` duplicated verbatim (`tool-loop.ts:70-81`, `native-tool-loop.ts:44-55`) — CQ-025.
- Path-containment helper copy-pasted four times with the same bug — CQ-013.
- `storeConversation`/`getContext` implemented twice in `memory` with the same duplicate-write behaviour — CQ-021.
- Builtin dispatch (`tools/src/builtins/index.ts`, 891-line `switch`) repeats the same `try { … return { name, output, status:'completed' } } catch (error) { return { …status:'failed', error: error instanceof Error ? … } }` block per case (seen in `file_read` :195-210, `edit_file` :338-355, `run_shell` :360-378, `http_request` :382-400, `terminal` :520-532). A `wrap(name, fn)` helper would make status/error mapping uniform and shrink the switch substantially.
- `error instanceof Error ? error.message : String(error)` appears throughout instead of one `errorMessage(e)` helper (one already exists privately as `errMsg` in `slash-commands-extras.ts:1417`).

## 4. Comments

**Strength:** comments overwhelmingly explain *why*, often citing the incident they prevent (`runtime.ts:51-56`, `:163-165`, `:200-202`; `telegram.ts:283-286`; `process-guards.ts:3-12`; `local-event-bus.ts:50-58`). This is above average and makes intent recoverable.

**Weaknesses**
- Some comments assert behaviour the code does not have — worse than no comment:
  - `circuit-breaker.ts:6` "ONE probe call is permitted" — not enforced (CQ-022).
  - `tool-bus/src/policy.ts:10-11` "The runtime … consults `isToolAllowed` at every tool call" — package has no importers (CQ-024).
  - `ProcessSandboxOptions.networkEnabled` naming implies isolation that process mode does not provide (CQ-003).
- Comments referencing ticket/audit codes (`audit G-01`, `issue #73`, `Epic 5 F1`) are useful only with access to that history; prefer stating the invariant and keeping the reference as a suffix.
- 10 TODO/FIXME markers in source — low and acceptable.

## 5. Magic numbers / hard-coded values

Spread across modules without a single config home (CQ-026): approval TTL 86 400 000 ms (`runtime.ts:502`, also `harness/src/gateway.ts:209`), `DEFAULT_MAX_TOOL_ITERATIONS = 5` (`tool-loop.ts:68`), tool output 8 000 chars (`tool-loop.ts:4`, read from `process.env` at call time per tool call), HTTP body 32 000 (`network-tools.ts:32`), `web_fetch` 8 000/15 s (`web-fetch.ts:3,7`), reconnect 5 000 ms (`discord.ts:171`, `slack.ts:195`), retry cap 8 000 ms (`orchestrator.ts:144`), breaker 3/30 000 (`circuit-breaker.ts:41-42`). Some are env-tunable through ad-hoc `process.env` reads inside hot functions, which hides configuration from `anvio.yaml` validation.

## 6. Coding conventions and style compliance

- **Type escape hatches are rare**: 7 `any`, 8 `as unknown as` in non-spec source — good discipline. The ones that exist sit on persisted data (CQ-023), which is the worst place for them.
- **Formatting is not enforced**: Prettier reports 388 non-compliant files; at least one visibly mis-indented statement (`orchestrator.ts:199`). Diffs on these files will churn once formatting is applied — do it in one isolated commit.
- **Lint coverage is partial** (CQ-017), so "lint passes" says nothing about `platform`, `cli`, `harness`, `runtimes`, `integrations`.
- Inline `import('@anvio/core').SkillDefinition['spec'][]` type in a signature (`runtime.ts:431`) and inline `import('@anvio/core').ChannelType` casts (`harness/src/runtime-tool-port.ts:89`) instead of top-level imports.
- `export * from './orchestrator.js'` at the bottom of `runtime.ts:524` — the runtime module doubles as a barrel, so importing the runtime drags the orchestrator and `uuid`.

## 7. Technically correct but hard to maintain — examples

1. **`walkFallbackChain` overloaded third parameter** (`fallback-chain.ts:24-34`): accepts either an options object or a legacy function. Every caller pays for a backward-compat shim with no external consumers (monorepo-internal). Remove the overload.
2. **`useNativeTools` computation** (`runtime.ts:176-179`) calls `getModelToolDefinitions()` to test truthiness, then calls it again at `:207`; `listTools()` is called up to 3× per iteration (`:178,181,302`). Each call rebuilds arrays from config; the intent "does this port have tools" deserves one named boolean.
3. **Closure-mutated shared sets in orchestrator** — correctness depends on the exact order of `add`/`push` calls in `runSingleTask`; an innocent refactor (e.g. moving `results.push`) changes `finalize` status.
4. **`ToolGateway.load` catch-all** (`gateway.ts:203-211`) — looks like a sensible default, hides config errors (CQ-012).

## 8. Verdict

Readability at the statement level is good (clear names, why-comments, strict TS). Maintainability is dragged down by a handful of very large orchestration functions and files that concentrate most of the confirmed defects, plus duplication of security-relevant helpers. Score in `00-executive-summary.md`.
