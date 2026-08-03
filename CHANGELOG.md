# Changelog

All notable changes to Anvio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Token optimization Layer 1 — sliding window + auto-summarize on overflow** (ADR-0010). `memoryConfigSchema` gains `maxShortTermMessages` (default `0` = unlimited, backward-compatible) and `summarizeOnOverflow` (default `true`). When history exceeds the cap, `FilesystemMemoryProvider.storeConversation` compresses the older head into a single `[Context summary — N earlier messages compressed]` assistant message and keeps the newest half. Platform wires `SessionSummarizer` (`@anvio/learning`) as the summarizer callback with rule-based fallback on LLM error. A 200-turn session no longer sends 200 messages of history on turn 201.
- **Token optimization Layer 2 — Anthropic prompt caching** (ADR-0010). `AnthropicProvider` accepts `promptCaching` option (default `true`; opt-out via `ANVIO_PROMPT_CACHING=false`) and tags the system prompt block plus the last tool definition with `cache_control: { type: 'ephemeral' }`. `TokenUsage` gains optional `cacheCreationInputTokens` and `cacheReadInputTokens`; `inputTokens`/`totalTokens` now include cached tokens so audits see the true prompt cost, with cache hits billed at ~10% of normal input. A 20-turn session with a 2 000-token system prompt saves ~38 000 input tokens.
- **Token optimization Layer 3 — tool output truncation** (ADR-0010). `formatToolResultMessage` gains a `maxOutputChars` option and a new `clipToolOutput(body, max)` helper preserves head + tail with a `[… N chars truncated …]` marker. Both `executeParsedToolCalls` (fenced-block loop) and `executeNativeToolCalls` (native `tool_use` loop) resolve the clip limit via `resolveMaxToolOutputChars()`, reading env var `ANVIO_MAX_TOOL_OUTPUT_CHARS` (default `8000` chars ≈ 2 000 tokens; `0` disables). Errors are never clipped so failure diagnostics stay intact. Prevents a single 50 KB file read from inflating every subsequent turn.
- **Gemini native tools coverage** — confirmed end-to-end via `gemini-native-tools.spec.ts`: `GeminiProvider.supportsNativeTools = true`, `tools.functionDeclarations` block emitted from `ChatRequest.tools`, `functionCall` extracted as `ModelToolCall`, prior assistant tool call + tool response correctly serialized as `role: model → functionCall` / `role: user → functionResponse`. Closes the P6+ "Gemini native tools" remaining item.
- **LLM SoulData extraction** — new `extractSoulData(source, slug, modelProvider?)` in `@anvio/souls` (`packages/souls/src/soul-data-llm.ts`) LLM-projects SOUL.md into `SoulDefinition.spec` (identity, values, personality, preferences, communicationStyle, longTermGoals, behavioralTendencies). Falls back to `parseSoulDefinitionMd` regex baseline when no usable provider is supplied, when the JSON is unparseable, or when the model call throws. `SoulService.importFromMarkdown(source, slug, { modelProvider, save })` wraps it. CLI: `anvio soul import <SOUL.md> --slug <slug> --llm` runs the LLM path and prints the extracted identity alongside the policy.

- **OpenAI Realtime WebSocket STT — full live streaming** (closes P15+ deferred item). `OpenAiRealtimeSttSession` now auto-connects on first `feed()` (was: connect only in `end()`), drains any pre-connect chunks after the socket opens, and surfaces `conversation.item.input_audio_transcription.delta` events through a new async iterator `events()`. `streamRealtimeTranscribe(session, chunkSource)` yields real partial + final transcript events pumped from a background feeder; the generic `streamTranscribe` in `streaming-stt.ts` delegates to that when the session is an `OpenAiRealtimeSttSession`, so `anvio voice realtime-transcribe <file>` now emits real deltas instead of fake `[streaming:Nb]` placeholders. New `url` option lets tests point at a mock WebSocket server. Errors surface as `{ text: '[error] …', final: true }` events. Covered by `openai-realtime-stt.spec.ts` (mock ws server: auto-connect, delta streaming, `streamRealtimeTranscribe` pipeline, `onPartial` cumulative callback, no-key stub).

### Fixed
- **MCP first-call gate not persisting on local-runtime approvals** — the gateway-worker path already called `mcpFirstCallGate.approveToolName` on `APPROVAL_DECIDED`, but the platform's local `onApproval` callback (used by direct-runtime channels without a gateway) did not, so approving an MCP tool interactively in `anvio chat` re-prompted on every subsequent call. Now hoisted into the shared `onApproval` handler so both paths persist. Coverage added in `mcp-tool-port.spec.ts` (9 tests: non-MCP passthrough, pending on first call, pass through after approve, disabled bypass, per-session/per-tool isolation, malformed name, listing, instructions).

---

## [1.24.1] - 2026-07-04

**CI/CD stability and docs auto-sync fixes**

### Fixed
- **pnpm lockfile out of sync** — committed updated `pnpm-lock.yaml` after `@anvio/goals` was added to `packages/platform` deps; resolves `ERR_PNPM_OUTDATED_LOCKFILE` on every CI `pnpm install --frozen-lockfile` run
- **Lint errors in `@anvio/skills`** — suppressed `@typescript-eslint/no-this-alias` in `composable-registry.ts` (required by method object literal pattern); removed stale `// eslint-disable-next-line no-new-func` in `executor.ts` where `no-new-func` rule is not active
- **Docs changelog never auto-updated** — `notify-docs.yml` only watched `docs/**`; `CHANGELOG.md` lives at repo root so releases never triggered a sync. Added `CHANGELOG.md` to paths filter and added a `Notify docs repo` step to `release.yml` so every published GitHub Release dispatches to anvio-docs immediately

---

## [1.24.0] - 2026-07-04

**Hermes-parity: skill runtime gaps closed — versioning, test runner, goals integration, step output piping, workflow skill node**

### Added
- **`skill` node in workflow DAG** — `workflowNodeTypeSchema` now includes `'skill'`; `WorkflowNode` gains `skill?: string` and `params?: Record<string,unknown>`; `DagExecutor.runNode()` handles `case 'skill'` by delegating to injected `runSkill()` dep (wired in platform via `executeSkill`). Closes the workflow→skill integration gap
- **Step output piping to prompt** — `SkillExecuteResult` now includes `trace: string` — a formatted markdown execution trace (step name, status icon, output snippet, final outputs map). `skillCallTool` detects the `{ outputs, trace }` shape and returns the trace as rich LLM-readable text so the model can reason about what each step produced
- **Skill versioning & upgrade** — `SkillInstaller.upgrade(slug)` compares installed vs bundled catalog version and overwrites + records the upgrade atomically; new CLI command: `anvio skill upgrade <slug>` prints `1.0.0 → 1.1.0` diff or "already up to date"
- **Skill test runner** — `SkillTestRunner` / `createSkillTestRunner()` wraps `executeSkill` with a `MockToolPort` that records all calls and returns configurable stub outputs; `anvio skill test <slug> [--params '{}'] [--stub '{}']` prints step-by-step trace and tool calls, exits non-zero on failure
- **Goals integration (4 gaps closed)**:
  - `GoalSpec.skills[]` — list of skill slugs assigned to goal-responsible agents (schema addition, backward-compatible)
  - `GoalSpec.onComplete.workflow` — trigger a workflow slug when goal transitions to completed
  - `SkillStep.goalSlug` + `SkillStep.progressIncrement` — a step can auto-increment linked goal progress on success; platform `callSkill` wires this via `FilesystemGoalEngine.updateProgress()`
  - `@anvio/goals` added to platform dependencies so goal engine is available in runtime context

### Changed
- `SkillCallFn` return type extended to accept `SkillCallResult = { outputs, trace }` in addition to raw `Record<string,unknown>|string` — backward-compatible
- Platform `callSkill` now returns `{ outputs, trace }` instead of raw `result.outputs`

---

## [1.23.0] - 2026-07-04

**Skill execution engine — Hermes-parity structured authoring + mechanical runtime**

### Added
- **Skill parameter validator (L1)** — `validateParams()` enforces required fields, type coercion (`string`/`number`/`boolean`/`array`/`object`), enum membership, and defaults; `interpolateArgs()` replaces `{{varName}}` in step args from the param + output context (`packages/skills/src/param-validator.ts`)
- **Skill executor (L2)** — `executeSkill()` runs `steps[]` mechanically against a `RuntimeToolPort`: evaluates `condition` expressions (restricted `Function` over param+output vars), calls tools directly, stores results as named output variables, handles `onError` (`fail`/`skip`/`retry` with `maxRetries`), supports `skill:<slug>` sub-skill chains, and enforces `timeout` via `AbortSignal` (`packages/skills/src/executor.ts`)
- **Trigger matcher (L3)** — `matchTriggers()` scans all catalog skills and returns slugs whose `triggers[]` match an inbound message (string: case-insensitive substring; object: `event`+`channel`). Auto-activated skills are merged into the agent's skill list before system prompt assembly — no agent config change needed (`packages/skills/src/trigger-matcher.ts`)
- **Composable skill registry (L4)** — `ComposableSkillRegistry` wraps skills with `composable: true` as `skill__<slug>` tools with typed parameter schemas for native `tool_use`; dispatches calls through `SkillExecutor`; resolves `skill:<slug>` step references for skill-chain execution (`packages/skills/src/composable-registry.ts`)
- **`skill_call` gateway tool (L5)** — `anvio_tools__skill_call(slug, params)` (enabled by default) lets the LLM explicitly invoke any skill mid-session with validated typed params; prose-only skills return rendered instructions; structured skills return `outputs` map as JSON (`packages/tools/src/builtins/skill-call.ts`)
- **Runtime wiring** — `AgentRuntime` now: (a) runs `matchTriggers` on the inbound message and merges auto-activated skills before prompt assembly; (b) pre-registers agent skills into `ComposableSkillRegistry`; (c) wraps the base `toolPort` with composable skill tools so `skill__*` calls are served without going through the LLM; `platform/src/index.ts` injects `skillCatalog` into runtime deps and wires `callSkill` via `toolGateway.mergeContext`
- **Skill schema v2 fields** — `parameters[]`, `steps[]` (with `tool`, `args`, `condition`, `onError`, `maxRetries`, `output`), `outputs[]`, `triggers[]`, `composable`, `timeout` — all backward-compatible (existing prose-only skills still parse with empty defaults)
- **Bundled `code-review` skill v2** — upgraded reference example using all v2 fields; workspace `code-review.md` and `architecture.md` also upgraded
- **Design doc** — `docs/77-skill-execution-engine.md` documents all 5 layers, field-to-layer mapping, and error types

### Changed
- `renderSkillInstructions` now renders `parameters`, `steps`, and `outputs` sections into the agent prompt in addition to `name + description + instructions`
- `renderSkillMd` (learning loop draft writer) serialises all new schema fields into generated `.md` files
- Gateway tool count: 73 → 74 (`skill_call` added)

---

## [1.22.0] - 2026-07-04

**Web dashboard + tool/runtime polish**

### Added
- **Web dashboard** (`apps/web`) — Next.js 15 + Tailwind 4 dashboard UI with 5 pages: Overview (stats cards), Sessions (table with status badges), Agents (card grid), Gateway Tools (enabled/disabled), Metrics (Prometheus parser + auto-refresh). Dark theme, sidebar navigation, proxies to `apps/api`. Run with `pnpm --filter @anvio/web dev` (port 3100)
- **API: overview endpoint** — `GET /api/overview` returns sessions/agents/tools counts and uptime
- **API: tools endpoint** — `GET /api/tools` lists all 73 gateway tool keys with enabled status
- **API: sessions list** — `GET /api/sessions` lists all sessions (with auth filtering)
- **Nous Portal OAuth** — `anvio setup-token --nous` (1-click model + tools login via local OAuth callback host, no vendor CLI required; `--token` for headless, `ANVIO_NOUS_MOCK=1` for dev/test)
- **Singularity/Apptainer runtime** — `SingularityRuntimeProvider`, `anvio runtime exec singularity -- <cmd>` (local HPC container exec, `SINGULARITY_IMAGE` + `SINGULARITY_BINARY`, `ANVIO_SINGULARITY_MOCK=1` for dev/test)
- **Atropos RL training — live fallback** — `rl_tool` now calls a direct Tinker-Atropos HTTP API (`ATROPOS_API_URL`/`ATROPOS_API_KEY`) when MCP isn't configured, with `ANVIO_ATROPOS_MOCK=1` for dev/test, instead of only returning a static MCP-setup note
- **Yuanbao tools** — `yb_tool` action bundle (`query_group_info`, `query_group_members`, `send_dm`, `search_sticker`, `send_sticker`) via MCP preset (`workspace/mcp/presets/yuanbao.yaml.example`) or `ANVIO_YUANBAO_MOCK=1` for dev/test
- **Video tools — real implementation** — `video_analyze` now extracts a frame via `ffmpeg` (local files and remote URLs, `FFMPEG_BINARY` to override the binary) and runs vision analysis on it instead of returning a stub note; `video_generate` now delegates to an MCP `video-gen` preset with `ANVIO_VIDEO_MOCK=1` for dev/test
- **Real IMAP IDLE (RFC 2177)** — `idleWatchInbox` now issues a genuine `IDLE` command over a persistent connection and wakes immediately on untagged `EXISTS`/`RECENT`/`EXPUNGE` (falls back to the fixed-interval poll loop when the server's `CAPABILITY` doesn't advertise `IDLE`)
- **Honcho gateway tools** — `honcho_tool` action bundle (`context`, `profile`, `search`, `conclude`) exposing the existing `@anvio/memory` Honcho provider via MCP preset (`workspace/mcp/presets/honcho.yaml.example`) or `ANVIO_HONCHO_MOCK=1` for dev/test
- **hermes-tech skills catalog CI** — [`.github/workflows/hermes-skills-catalog.yml`](.github/workflows/hermes-skills-catalog.yml) runs `scripts/import-hermes-skills.sh` weekly (+ manual dispatch) and opens a PR when the imported skill catalog changes, instead of requiring a manual local run

### Fixed
- **Stale gap-register docs** — [69-post-v1.17-gap-register.md](docs/69-post-v1.17-gap-register.md) and [51-gap-hermes-slaude.md](docs/51-gap-hermes-slaude.md) hadn't been updated since the v1.17 baseline despite P12/P13/P14 (v1.18–v1.19) already shipping most of their listed gaps — corrected to reflect actual shipped state

---

## [1.21.1] - 2026-07-02

**Runtime OAuth polish — full vendor runtimes + chain fallback**

### Added
- **Codex, Cursor, Antigravity runtime providers** — OAuth via connection broker (`codex exec`, `agent -p`, `agy -p`)
- **Antigravity CLI auto-install** — `anvio setup-token --antigravity` runs official Google install script when `agy` is missing
- **Chain fallback** — `runtime.fallbacks: [cursor, codex, local]` walks A → B → C
- **Auth failure-time failover** — OAuth expired / 401 mid-run retries next runtime in chain

### Docs
- README storage/OAuth/model auth catalog; ADR 0009 updated for implemented runtimes and fallback chain

---

## [1.21.0] - 2026-07-02

**Runtime OAuth — Claude Code, Cursor, Codex vendor login**

### Added
- **Claude Code OAuth runtime** — `ClaudeCodeRuntimeProvider` via `@anthropic-ai/claude-agent-sdk` (Pro/Max subscription, not API key)
- **`anvio setup-token`** — unified vendor login: `--claude`, `--cursor`, `--codex`, `--antigravity`, `--list`
- **Runtime routing** — `RuntimeRoutingAgentRuntime` delegates to external runtimes when configured; falls back to local model loop
- **Connection broker integration** — per-user OAuth tokens (`anvio setup-token --claude --user alice`)
- Cross-runtime fallback binding (`claude-code` → `cursor` → `local`)

### Docs
- [ADR 0009 — Runtime OAuth authentication](./docs/adr/0009-runtime-oauth-authentication.md)
- Docker/server/headless OAuth patterns and multi-user deployment guide

---

## [1.20.0] - 2026-06-20

**Unified gateway + SQLite sessions + OpenAI Realtime STT**

### Added
- **Unified gateway daemon** — `anvio gateway start|stop|status` (channels + worker + REST + WebSocket in one process)
- `startUnifiedGateway()` in `@anvio/platform` — Hermes `GatewayRunner` equivalent
- **SQLite session store** — `storage.provider: sqlite` → `workspace/state.db` with FTS5 message search
- **OpenAI Realtime STT** — `anvio voice realtime-transcribe`, `ANVIO_VOICE_REALTIME=1`
- `registerGatewayWorker()` shared by gateway app and legacy worker

### Docs
- [76-unified-gateway.md](./docs/76-unified-gateway.md)
- README updated for v1.20 gateway workflow

---

## [1.19.0] - 2026-06-20

**Phase P13 + P14 — Remote runtimes, channels depth, research tooling**

### Added — P13
- `SshRuntimeProvider.execRemote` + `anvio runtime exec ssh|daytona|modal -- <cmd>`
- Daytona/Modal remote exec with mock mode (`ANVIO_DAYTONA_MOCK`, `ANVIO_MODAL_MOCK`)
- Streaming STT session (`ChunkedStreamingSttSession`) + `anvio voice stream-transcribe`
- IMAP IDLE watch (`EMAIL_IMAP_IDLE=1`) and Message-ID/References email threading

### Added — P14 (P12 partial closure)
- MCP preset E2E tests for spotify, feishu, tinker-atropos
- `ANVIO_BROWSER_CDP_GRANT=1` extended browser_cdp methods (goto, click, fill, …)
- Harness channel format snapshot tests
- Google Chat service account delivery (`GOOGLE_CHAT_SERVICE_ACCOUNT`, `GOOGLE_CHAT_SPACE`)
- Teams/Matrix `fetchWithRetry` with exponential backoff
- Feishu webhook channel + SMS (Twilio) channel adapters
- Workflow→skill example + `workspace/skills/dag-report-skill.md`
- Langfuse dashboard JSON template (`configs/observability/langfuse-dashboard.json`)
- Session trajectory export: `anvio session export <id> [--md]`
- Desktop app scaffold (`apps/desktop/README.md`)

### Docs
- [73-phase-p13-priorities.md](./docs/73-phase-p13-priorities.md)
- [74-workflow-to-skill-example.md](./docs/74-workflow-to-skill-example.md)
- [75-phase-p14-priorities.md](./docs/75-phase-p14-priorities.md)

---

## [1.18.0] - 2026-06-20

**Phase P12 — Integration polish & slaude UX**

### Added
- MCP `allowedTools` per-server allowlist; catalog filter in `loadMcpToolCatalog`
- `anvio mcp preset list|apply <name>` — merge workspace presets into `mcp/servers.yaml`
- Harness `toolSurface: mcp_and_channel` — hide built-in gateway tools on channels
- `anvio session 1on1 [--agent NAME]` — dedicated CLI session with persistent metadata
- Harness exports `anvio_channel__set_status` and `anvio_channel__edit` to model tool defs
- Signal outbound via signal-cli REST (`SIGNAL_CLI_REST_URL`)

### Fixed
- GitHub Actions CI — remove conflicting pnpm `version` pin (use `packageManager` from package.json)

### Docs
- [69-post-v1.17-gap-register.md](./docs/69-post-v1.17-gap-register.md)
- [70-phase-p12-priorities.md](./docs/70-phase-p12-priorities.md)
- [71-mcp-setup-guide.md](./docs/71-mcp-setup-guide.md)
- [72-observability-langfuse.md](./docs/72-observability-langfuse.md)

---

## [1.17.0] - 2026-06-19

**Phase P11 — Hermes tool parity (21 → 71 built-in gateway tools)**

### Added
- **P11a** — Built-in catalog 12 → 21: `list_dir`, `edit_file`, `run_shell`, `http_request`, `path_exists`, `file_delete`, `append_file`, `json_parse`, `datetime_now`; OTel spans in worker/API; `anvio planner run`
- **P11b** — +21 tools: `web_extract`, `patch_file`, `search_files`, browser session (8), `terminal`, `process`, `todo`, `clarify`, `session_search`, `vision_analyze`, kanban (4)
- **P11c** — +15 tools: kanban depth (6), browser depth (4), `delegate_task`, `cronjob`, `skills_list`, `skill_view`, `send_message`; `KanbanStore.updateTask`; `ToolGateway.mergeContext()`
- **P11d** — +14 tools: Home Assistant (4), `mixture_of_agents`, `x_search`, `video_*`, `computer_use`, `discord_admin`, `skill_manage`, `spotify_search`, `feishu_doc_read`, `rl_tool`; MCP presets in `workspace/mcp/presets/`

### Docs
- [65-hermes-tools-catalog.md](./docs/65-hermes-tools-catalog.md) — full Hermes → Anvio mapping
- [64-phase-p11a-priorities.md](./docs/64-phase-p11a-priorities.md) through [68-phase-p11d-priorities.md](./docs/68-phase-p11d-priorities.md)

---

## [1.15.0] - 2026-06-19

**Phase P10 — Usage CLI, IMAP, MCP health, Prometheus**

### Added
- `anvio usage stats [--json] [--last 24h]` from `audit/tokens.jsonl`
- Email IMAP polling (`pollInbox`, worker auto-start)
- `McpBridge.getHealthReport()` and `anvio mcp health`
- Prometheus metrics registry + `GET /api/metrics`

### Docs
- [63-phase-p10-priorities.md](./docs/63-phase-p10-priorities.md)

---

## [1.14.0] - 2026-06-19

**Phase P9 — Token usage, MCP reconnect, SMTP, Teams cards**

### Added
- `addTokenUsage` + stream usage parsing (Gemini, OpenAI-compatible)
- `TokenUsageAudit` → `workspace/audit/tokens.jsonl` with cost estimates
- MCP stdio auto-reconnect (`invalidate`, max 3 restarts)
- Email SMTP outbound via STARTTLS (`sendSmtpMail`)
- Teams Adaptive Card approval UI + invoke handler

### Changed
- Agent runtime accumulates token usage across tool iterations
- Worker uses `finalizeAgentRun()` for completed runs

### Docs
- [62-phase-p9-priorities.md](./docs/62-phase-p9-priorities.md)

---

## [1.13.0] - 2026-06-19

**Phase P8 — MCP stdio, channel E2E, LLM SoulPolicy**

### Added
- `McpStdioClient` with stdio transport (`transport: stdio|stub` in mcp/servers.yaml)
- Teams Bot Framework webhook + outbound; Matrix room webhook; Email inbound/outbound queue
- API routes: `POST /api/channels/teams/webhook`, `POST /api/channels/matrix/webhook`
- LLM `extractSoulPolicy` from SOUL.md with regex fallback and id verification
- Harness profiles for teams, matrix, email channels

### Docs
- [61-phase-p8-priorities.md](./docs/61-phase-p8-priorities.md)

---

## [1.12.0] - 2026-06-19

**Phase P7 — Gemini native tools + MCP agent runtime**

### Added
- Gemini provider: native `functionCall` / `functionResponse` with `supportsNativeTools`
- `McpToolPort` exposes enabled MCP servers to agent runtime as `anvio_mcp__{server}__{tool}`
- `McpFirstCallGate` — first MCP tool use per session requires approval (`firstCallApproval` in mcp config)
- Worker persists `mcpApprovedTools` on approval and resumes agent runs

### Docs
- [60-phase-p7-priorities.md](./docs/60-phase-p7-priorities.md)

---

## [1.11.0] - 2026-06-19

**Phase P6 — OpenAI native tools, memory recall, strict harness, CI fixes**

### Added
- OpenAI-compatible providers: native `tool_use` / `tool_calls` streaming (`supportsNativeTools`)
- Built-in `anvio_tools__memory_recall` wired to memory provider search (FTS5 / keyword index)
- Strict harness: messaging channels no longer fall back to raw assistant dump; require `anvio_channel__reply`
- Harness reply tracking (`resetReplyTracking`, `hasDeliveredReply`)

### Fixed
- Export `ChannelHealthReport` from `@anvio/core` (CI `@anvio/channels` build)
- Type-safe `summarizeChannelHealth` exhaustive switch
- Slack block-action payload typing for approver `user.id`

### Docs
- [59-phase-p6-priorities.md](./docs/59-phase-p6-priorities.md)

---

## [1.10.0] - 2026-06-19

**Phase P5 — Multi-channel harness approval loop**

### Added
- End-to-end approval: agent `anvio_channel__request_approval` → pause → resume on any channel
- `HarnessAwareToolPort` merges built-in tools + channel tools when harness enabled
- Approver IDs with channel prefix (`slack:`, `telegram:`, `whatsapp:`, …)
- `approvalTimeoutSeconds` enforced in `ApprovalGate`
- Worker publishes `APPROVAL_REQUESTED`; resume via checkpoint after `APPROVAL_DECIDED`
- Interactive approve/reject with approver auth on Slack, Telegram, WhatsApp, Discord, Mattermost

### Docs
- [58-phase-p5-harness-approval.md](./docs/58-phase-p5-harness-approval.md)

---

## [1.9.0] - 2026-06-19

**Phase P4 — Native tool_use & expanded gateway**

### Added
- Anthropic native `tool_use` API in agent runtime (`supportsNativeTools`)
- `ModelToolDefinition`, `ModelToolCall`, `getModelToolDefinitions()` on tool gateway
- Tools: `glob_files`, `grep_search`, `execute_code_pipeline` (T1/T5)
- `anvio kb import-manifest` — workspace manifest import (replaces slaude naming)
- Example `configs/examples/workspace-manifest.json`

### Changed
- Removed slaude branding from docs; Hermes-focused parity narrative
- `import-slaude` CLI kept as deprecated alias

### Docs
- [57-phase-p4-priorities.md](./docs/57-phase-p4-priorities.md)

---

## [1.8.0] - 2026-06-19

**Phase P3 — Media tools, slaude import, scheduled learning**

### Added
- `anvio_tools__image_generate` — OpenAI DALL-E 3, saves to `artifacts/images/`
- `anvio_tools__text_to_speech` — OpenAI TTS via `@anvio/voice`
- `anvio kb import-slaude` — import `slaude.json` knowledge + skills (S6)
- `anvio learning summarize-sessions` — batch session LLM/rule summarization
- Automation action type `learning.summarize_sessions` for cron
- Bundled automation `session-memory-summarize.yaml` (every 6h, disabled by default)
- Example manifest `configs/examples/slaude.json`

### Docs
- [56-phase-p3-priorities.md](./docs/56-phase-p3-priorities.md)
- Gap register: T3, T4, S6, L5 cron ✅

---

## [1.7.0] - 2026-06-19

**Phase L6 — Runtime learning & LLM skill evolution**

### Added
- Agent runtime **tool loop** (multi-turn, fenced `anvio_tool` blocks, max 5 iterations)
- `ToolGateway.setOnToolCompleted()` hook for runtime learning
- `LearningEngine.onToolUseCompleted()` — Hermes-style skill patch on tool success
- **LLM summarizer** for skill evolution (`SkillEvolutionSummarizer`) with `shouldCreate` gate
- LLM session summarizer when model provider configured (Anthropic preferred)
- `RuntimeToolPort` in `@anvio/core`
- Tool call parser, tool instruction renderer in `@anvio/tools`
- `publishAgentRunCompleted` / `finalizeAgentRun` in `@anvio/platform`
- Integration tests: Phase L6 runtime learning
- Unit tests: skill evolution summarizer, tool call parser

### Changed
- `anvio chat` and inline `anvio run` emit `AGENT_RUN_COMPLETED` (learning on CLI paths)
- Platform wires `ToolGateway` into `DefaultAgentRuntime` and learning model provider
- Auto-promote runtime skills when `soul.spec.evolution.requireApproval: false`
- Gap register updated: L5 session LLM ✅, L6 runtime self-improve ✅

### Docs
- [55-phase-l6-learning-priorities.md](./docs/55-phase-l6-learning-priorities.md)
- Updated [43-learning-loop.md](./docs/43-learning-loop.md), [50-hermes-slaude-parity.md](./docs/50-hermes-slaude-parity.md), [51-gap-hermes-slaude.md](./docs/51-gap-hermes-slaude.md)

---

## [1.6.0] - 2026-06-19

**Phase P2 — Voice on channels & Mattermost (desktop deferred)**

### Added
- Mattermost channel adapter with WebSocket `posted` events and REST posts
- Telegram voice note transcription hook (Whisper via `@anvio/voice`)
- Discord audio attachment transcription hook
- `VoicePipeline.transcribeBuffer()` and channel voice helpers
- Channel health probe for Mattermost
- Harness profile for Mattermost

### Changed
- Enable channel voice via `spec.channels.voice.enabled` or `ANVIO_CHANNEL_VOICE=1`
- Workspace schema adds `channels.mattermost`

---

## [1.5.0] - 2026-06-19

**Phase P1 — Channel harness depth & contextual connections**

### Added
- Connection broker: per-user isolation, thread grants, list/revoke APIs
- OAuth login-host callback capture (`startLoginHost`)
- CLI: `anvio connect list|put|revoke|login-host`
- Multi-channel harness regression tests (telegram, discord, web-chat)
- Connection isolation integration tests

### Changed
- Harness enabled by default in workspace (`enabled: true`)
- Connect broker enabled by default (requires `ANVIO_CONNECTION_ENCRYPTION_KEY`)

---

## [1.4.0] - 2026-06-19

**Phase K+ — Memory search, browser sandbox, ACP production path**

### Added

#### Learning & memory
- FTS5 recall layer via optional `better-sqlite3` (`memory.fts: true` in workspace)
- Honcho dialectic context merged into `getContext` when API key configured

#### Tooling
- `browser` built-in tool with Playwright sandbox (falls back to `web_fetch` when Playwright absent)
- Optional `playwright` dependency on `@anvio/tools`

#### Runtime & editor integration
- ACP `POST /prompt/stream` SSE endpoint for streaming agent responses
- `CursorRuntimeProvider` delegates to local ACP server (`anvio acp serve`)
- CLI ACP server reuses sessions and streams via `platform.runtime.stream`

### Changed
- Platform passes `memory.fts` to memory provider factory
- Fixed `getBySession` to skip recall index JSON (non-array entries)

---

## [1.3.0] - 2026-06-19

**Phase K — Priority pillars:** Learning & memory, Automation & workflows, Authoring (Phase J), Tooling, Runtime.

### Added

#### Learning & memory
- Session summarizer stores compact summaries on session end
- Filesystem cross-session recall index (keyword-based)
- `LearningEngine.proposeFromToolUse()` for runtime skill drafts

#### Automation & workflows
- `PlanExecuteReviewEngine` — PLAN → EXECUTE → REVIEW planner
- `configs/planner/plan-execute-review.yaml`

#### Authoring & workspace (Phase J)
- `parsePersonaMd()` — personas load from `personas/*.md`
- Example `workspace/personas/architect.md`
- `scripts/import-hermes-skills.sh` for hermes-tech skill import

#### Tooling & execution
- Built-in `file_read` and `file_write` tools
- `execute_code` routes through audited `CodeExecutor` when wired from platform

#### Runtime
- Docker sandbox in `@anvio/execution`
- First-class `DockerRuntimeProvider` in `@anvio/runtimes`

#### Documentation
- [52-phase-k-priorities.md](docs/52-phase-k-priorities.md) — five-pillar priority stack
- Updated gap register and roadmap for Phase K focus

### Changed
- `FilesystemMemoryProvider` injects recall hits into memory context
- Platform wires `createCodeExecutor` into `ToolGateway`

---

## [1.2.0] - 2026-06-19

**Platform layer & multi-model** — credential pools, provider routing, skills catalog, MCP integrations, and 18 model providers.

### Added

#### Platform (Phase E)
- **Credential Pools** (`@anvio/credentials`) — AES-256-GCM encrypted store with round-robin and failover
- **Provider Routing** (`@anvio/models`) — task classifier, fallback chain, and `routing.yaml` router
- **Skills Catalog** (`@anvio/skills`) — bundled + workspace override resolver and installer
- **Integration Framework** (`@anvio/integrations`) — MCP registry, bridge, and blueprint `mcp` step wiring
- 9 additional bundled skills in `configs/skills/`

#### Multi-model providers
- OpenAI-compatible drivers: OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Together, xAI, Fireworks, Moonshot, Cerebras, SambaNova, Perplexity, Cohere, Hugging Face, Ollama
- Gemini provider via Google Generative AI API
- `ModelProviderRegistry` — agents resolve provider from `spec.model.provider`
- `custom` provider for arbitrary OpenAI-compatible endpoints (`baseUrl` + `apiKeyEnv`)

#### CLI & workspace (U19)
- `anvio credentials`, `anvio routing`, `anvio skill`, `anvio mcp`, `anvio workspace validate`
- `anvio routing catalog|providers` — list supported and configured providers
- Workspace init scaffolds `providers/routing.yaml`, `mcp/servers.yaml`, `hooks/hooks.yaml`

#### Core schemas
- `credential`, `routing`, `mcp`, `model-provider` schemas and credential port

#### Tests
- Integration tests for credentials, routing, skills catalog, and MCP integrations

### Changed
- `DefaultAgentRuntime` uses per-agent model provider from registry
- `createPlatform()` registers all configured providers from environment
- Documentation and roadmap mark Advanced Agent OS Phases A–F complete

---

## [1.1.0] - 2026-06-19

### Added

#### Identity & memory
- **Soul System** (`@anvio/souls`) — persistent agent identity in `workspace/souls/`
- **Goal System** (`@anvio/goals`) — durable goals with progress tracking
- **MemoryProvider** port and factory — unified memory abstraction over filesystem (default)

#### Automation & workflows
- **Automation Engine** (`@anvio/automation`) — cron scheduler with filesystem state in `workspace/automations/`
- **Blueprint Catalog** (`@anvio/blueprints`) — DAG blueprint executor and template engine
- 8 built-in blueprints in `configs/blueprints/` (daily-summary, github-triage, security-audit, …)
- **Event Hooks** (`@anvio/hooks`) — script, webhook, and MCP hook handlers

#### Coordination
- **Kanban Engine** (`@anvio/kanban`) — task boards with worker lane routing
- **Batch Processing** (`@anvio/batch`) — scheduled batch jobs with filesystem progress store
- **Subagent Delegation v2** — task planner and delegation progress tracking in `@anvio/agents`

#### Execution
- **Runtime Providers** (`@anvio/runtimes`) — local, Claude Code, Codex, Cursor, external stub
- **Code Execution** (`@anvio/execution`) — sandboxed process executor with audit log
- **ACP Editor Integration** (`@anvio/acp`) — Agent Client Protocol server for editor attach

#### Core schemas & ports
- Schemas: soul, goal, automation, batch, blueprint, kanban, hook
- Ports: soul, goal, memory-provider, runtime-provider, code-execution, kanban, batch

#### CLI commands
- `anvio soul`, `anvio goal`, `anvio blueprint`, `anvio automation`, `anvio cron`
- `anvio hooks`, `anvio kanban`, `anvio batch`, `anvio runtime`, `anvio exec`, `anvio acp`

#### Workspace templates
- `workspace/souls/architect-soul.yaml`, `workspace/hooks/hooks.yaml`, `workspace/automations/daily-summary.yaml`

#### Documentation
- Advanced Agent OS overview (docs 24–40) and implementation plan
- Updated architecture and roadmap for Phase A–E

#### Tests
- Integration tests for Phase A/B, delegation, kanban, and batch

### Changed
- `createPlatform()` wires soul service, blueprint executor, automation engine, and hook engine
- Agent schema supports `spec.soul` alongside persona fallback
- Workspace schema extended for advanced OS configuration

---

## [1.0.0] - 2026-06-19

### Added

#### Core platform
- Monorepo with pnpm workspaces and Turborepo (`apps/` + `packages/`)
- `@anvio/core` — Zod schemas, ports, and shared types
- `@anvio/platform` — `createPlatform()` composition factory wired from `anvio.yaml`
- `@anvio/workspace` — workspace loader, filesystem session store, artifact helpers
- Progressive enhancement Levels 1–4 (filesystem → SQLite → PostgreSQL → K8s)

#### Agent runtime
- `@anvio/agents` — `DefaultAgentRuntime` with persona, skills, and memory integration
- `@anvio/personas` and `@anvio/skills` — YAML-driven configuration loaders
- `@anvio/models` — Anthropic provider with mock fallback when no API key is set
- `@anvio/memory` — filesystem memory store (default); PostgreSQL/Redis optional (Level 3)
- `SupervisorOrchestrator` for multi-agent delegation patterns

#### CLI (primary interface)
- `anvio init`, `anvio agents list`, `anvio chat`, `anvio run`
- `anvio sessions`, `anvio status`, `anvio logs`
- `anvio approve`, `anvio stop`, `anvio inbox`
- `anvio worktree list|create|remove` — optional git worktree isolation per session
- One-command installer: `scripts/install.sh`

#### Channels
- `ChannelHub` with session bridge and filesystem inbox
- Built-in adapters: CLI, REST API, Web Chat
- External adapters: Telegram, Discord, Slack (Socket Mode), WhatsApp (webhook)
- Channel config in `workspace/anvio.yaml` (`spec.channels.*`)
- WhatsApp webhook controller at `/api/channels/whatsapp/webhook`

#### Apps (optional Level 2+)
- `apps/api` — NestJS REST API (auth optional)
- `apps/worker` — background agent run consumer with channel progress events
- `apps/gateway` — WebSocket gateway

#### Storage & auth
- Filesystem storage provider (default) — no database required
- Auth disabled by default (`NoAuthProvider`); optional JWT/OAuth plugin
- Portable `workspace/` directory — backup, git, move without migration

#### Events
- In-process `LocalEventBus` (default)
- NATS JetStream support (optional Level 3)

#### Documentation
- Architecture docs, ADRs (local-first, channel hub)
- Comprehensive README with Mermaid diagrams

#### CI
- GitHub Actions: lint, typecheck, test, build on `main` and PRs
- Release workflow — auto-publish GitHub Releases from `v*` tags using `CHANGELOG.md`

#### Channel health
- `anvio channels status [--json]` — probe credentials and connectivity without starting the worker
- Health states: `healthy`, `degraded`, `disabled`, `misconfigured`, `unreachable`

### Changed

- Architecture revised from enterprise/SaaS assumptions to local-first defaults
- Personas and skills moved from database to filesystem config loaders
- API no longer requires JWT authentication by default

### Security

- Runtime workspace data (`memory/`, `sessions/`, `inbox/`, `worktrees/`, `artifacts/`) excluded from git

---

## Release process

1. Update `[Unreleased]` section in this file with your changes
2. Move entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading
3. Commit, tag, and push:

   ```bash
   git tag -a v1.0.1 -m "Anvio v1.0.1"
   git push origin main --tags
   ```

4. GitHub Actions **Release** workflow validates the build and publishes a GitHub Release with notes extracted from this file.

[Unreleased]: https://github.com/viantonugroho11/Anvio/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/viantonugroho11/Anvio/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/viantonugroho11/Anvio/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/viantonugroho11/Anvio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/viantonugroho11/Anvio/releases/tag/v1.0.0
