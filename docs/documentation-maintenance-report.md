# Documentation maintenance report — 2026-10-25

**Branch:** `docs/phase-5-documentation-modernization` (from `main` @ `e027717`).
**Scope:** documentation and AI-agent configuration only.

- **No application code changed.** Nothing under `packages/*/src`, `apps/*/src` or tests was modified.
- **Evidence order** followed the directive: verified runtime behaviour, then source code, then schemas, then tests, then ADRs, then audits, then existing docs.
- **Outcome:**
  - Root README rewritten.
  - 27 obsolete documents detached.
  - 4 plans moved into `docs/plans/`.
  - ADRs reconciled; 2 new ADRs added.
  - A single roadmap and a single docs index created.
  - AI-context exclusions configured for Claude Code, Cursor, Windsurf, Copilot and generic agents (`AGENTS.md`).

## 1. Documents rewritten

| File                      | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`               | Rewritten from scratch.<br>• **Positioning:** now an extensible multi-agent platform, no longer "Local-First AI Agent OS" (ADR-0038).<br>• **Required structure:** every required section, plus two Mermaid diagrams.<br>• **Labels:** gaps and unverified parts are marked _experimental_ or _not verified live_.<br>• **Quick Start:** previously ran `anvio chat --agent architect` on a fresh `anvio init`. That fails because `init` creates no agents or personas; the new version adds the missing step. |
| `docs/02-architecture.md` | Became the canonical system overview: component map (Mermaid), request sequence, agent-management mechanisms, auth layers, tiers, extension points, ADR links. The old page had local-first positioning and no flows.                                                                                                                                                                                                                                                                                           |
| `docs/07-mcp.md`          | Was a 12-line generic description. Now records the actual components: stdio NDJSON client, HTTP client, first-call approval gate, `mcp_manage`, the environment-inheritance gap.                                                                                                                                                                                                                                                                                                                                |
| `docs/14-deployment.md`   | Claimed "Phase 1 VM with Docker Compose" and a "Phase 4 Kubernetes Helm chart" (no chart exists). Replaced with a table of supported modes, each with its verification status.                                                                                                                                                                                                                                                                                                                                  |

## 2. Documents updated (partial edits)

| File                                                                       | Edit                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md`                                                                | Positioning (ADR-0038).<br>Factual fixes:<br>• the **persona** body is the system prompt, not the agent body;<br>• sessions are `*.json`, not `*.jsonl`;<br>• Qdrant is a stub;<br>• 15 channels;<br>• about 75 tools;<br>• the `a2a` package was missing from the list;<br>• ACP is a proprietary bridge;<br>• Daytona and Modal are exec-only.<br>Added the documentation-authority policy and links to the docs index, roadmap and ADR index. |
| `AGENTS.md`, `.github/copilot-instructions.md`                             | Documentation-authority policy appended. The existing (caveman) instructions are unchanged.                                                                                                                                                                                                                                                                                                                                                      |
| `docs/24-advanced-agent-os-overview.md`                                    | "Local First" principle replaced by "Local by default"; "Plugin Based" replaced by "Port based (no plugin system)"; plan link replaced by a ROADMAP link                                                                                                                                                                                                                                                                                         |
| `docs/27`, `30`, `31`, `32`, `33`, `34`, `35`, `36`, `38`, `40`            | Each "Extension Guide" section now starts with a status note: plugin or plugin-manifest items are design intent, and there is no plugin system (T-058)                                                                                                                                                                                                                                                                                           |
| `docs/29-memory-providers.md`, `docs/37-skills-catalog.md`                 | "Custom provider plugin" and "Plugin manifest for skills" sections marked **Not implemented**                                                                                                                                                                                                                                                                                                                                                    |
| `docs/35-workspace-architecture.md`                                        | `plugins/` directory annotated as reserved and not read                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/39-editor-integration.md`                                            | Status note: `packages/acp/{vscode,windsurf,zed,jetbrains}` do not exist; ACP is not the standard Agent Client Protocol (G-07/T-015)                                                                                                                                                                                                                                                                                                             |
| `docs/78-a2a-protocol.md`                                                  | "Current limitations (verified 2026-10-25)" section added (T-048, T-051, T-052, T-053); status reworded; ADR link fixed                                                                                                                                                                                                                                                                                                                          |
| `docs/30`, `41`, `43`, `44`, `74`, `76`, `apps/desktop/README.md`          | Links into detached documents replaced with current targets (ROADMAP, `anvio tools list`, audit phase 4)                                                                                                                                                                                                                                                                                                                                         |
| `CHANGELOG.md`, `evals/goldens/v1-seed/README.md`, `docs/plans/*-vnext.md` | Link paths rewritten after moves (18 lines in CHANGELOG); content unchanged                                                                                                                                                                                                                                                                                                                                                                      |
| ADRs 0001, 0003, 0004, 0005, 0006, 0007, 0026, 0032, 0033, 0034, 0035      | A dated _Reconciliation note_ was appended. Decision text is unchanged.                                                                                                                                                                                                                                                                                                                                                                          |

**New files:**

- `docs/README.md`
- `docs/ROADMAP.md`
- `docs/adr/README.md`
- `docs/adr/0038-extensible-agent-platform-positioning.md`
- `docs/adr/0039-in-house-mcp-client.md`
- `docs/plans/README.md`
- `docs/_detached/README.md`
- `docs/_detached/MANIFEST.md`
- this report
- `.claude/settings.json`
- `.cursorindexingignore`
- `.codeiumignore`
- `.cursor/rules/documentation-authority.mdc`
- `.windsurf/rules/documentation-authority.md`

## 3. Documents moved

All moves used `git mv`. The 27 detached documents are listed one by one, with title, reason and replacement, in [`_detached/MANIFEST.md`](_detached/MANIFEST.md).

| Old path                                                                                                                                                                           | New path                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/23-roadmap.md`                                                                                                                                                               | `docs/_detached/historical-plans/23-roadmap.md`                                     |
| `docs/52-…`, `53-…`, `54-…`, `55-…`, `56-…`, `57-…`, `58-…`, `59-…`, `60-…`, `61-…`, `62-…`, `63-…`, `64-…`, `66-…`, `67-…`, `68-…`, `70-…`, `73-…`, `75-…` (phase-priority plans) | `docs/_detached/historical-plans/<same name>`                                       |
| `docs/plans/2026-06-19-001-feat-advanced-agent-os-plan.md`                                                                                                                         | `docs/_detached/historical-plans/2026-06-19-001-feat-advanced-agent-os-plan.md`     |
| `docs/plans/2026-06-19-002-feat-unified-agent-product-plan.md`                                                                                                                     | `docs/_detached/historical-plans/2026-06-19-002-feat-unified-agent-product-plan.md` |
| `docs/50-hermes-slaude-parity.md`                                                                                                                                                  | `docs/_detached/superseded-designs/50-hermes-slaude-parity.md`                      |
| `docs/51-gap-hermes-slaude.md`                                                                                                                                                     | `docs/_detached/superseded-designs/51-gap-hermes-slaude.md`                         |
| `docs/65-hermes-tools-catalog.md`                                                                                                                                                  | `docs/_detached/superseded-designs/65-hermes-tools-catalog.md`                      |
| `docs/69-post-v1.17-gap-register.md`                                                                                                                                               | `docs/_detached/superseded-designs/69-post-v1.17-gap-register.md`                   |
| `docs/01-vision.md`                                                                                                                                                                | `docs/_detached/obsolete-docs/01-vision.md`                                         |
| `README.md` (copy, not a move)                                                                                                                                                     | `docs/_detached/old-readmes/README-v2.10.0.md`                                      |
| `docs/architecture-review-vnext.md`                                                                                                                                                | `docs/plans/architecture-review-vnext.md` _(still active)_                          |
| `docs/architecture-vnext-design.md`                                                                                                                                                | `docs/plans/architecture-vnext-design.md` _(still active)_                          |
| `docs/implementation-blueprint-vnext.md`                                                                                                                                           | `docs/plans/implementation-blueprint-vnext.md` _(still active)_                     |
| `docs/engineering-backlog-vnext.md`                                                                                                                                                | `docs/plans/engineering-backlog-vnext.md` _(still active)_                          |

A link rewriter resolved each link against the file's original location and recomputed it from the new one. It rewrote 259 links in 35 files, in both directions: links inside moved files, and links pointing at them.

## 4. Documents preserved unchanged

- **Numbered reference docs:** all other numbered documents (`03`–`22`, `25`, `26`, `28`, `42`, `45`–`49`, `71`, `72`, `77`).
- **ADRs:** every ADR not listed in §2.
- **Audits:** all of them.
  - `docs/audit/` (phases 1–4) is unchanged.
  - `docs/audits/` (code-quality, post-refactoring) is unchanged.
  - None was archived, because each still holds open findings referenced by the roadmap (directive §7.7).

**Why the numbered docs were not moved into `architecture/`, `guides/` and `reference/`.** The directive asks for that structure "when appropriate". Here it was judged not appropriate:

- The numbered paths are stable identifiers linked from application code (`packages/workspace/src/index.ts`, `apps/cli/src/main.ts`, `packages/platform`), from ADRs, from CLAUDE.md and from 98 Markdown files.
- Renaming about 50 files would break code-embedded references, or require editing application source.

Instead, [`docs/README.md`](README.md) groups the documents by those categories. `docs/plans/` and `docs/_detached/` were created as directories because they hold documents that change status.

## 5. ADRs superseded or deprecated

**None.** No evidence showed that a recorded decision had been reversed or abandoned. Changes made instead:

| ADR              | Action                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0007             | Stays ACCEPTED; its positioning is **amended** by new ADR-0038 (ACCEPTED, owner-directed). Technical defaults verified still true.                                        |
| 0006             | Stays ACCEPTED; a note records that the client is in-house, not SDK-based. The de facto design is in new ADR-0039 (**PROPOSED**; not accepted only because code matches). |
| 0004             | Note: **not implemented** (the `qdrant` provider is a stub). Owner to decide: implement or deprecate.                                                                     |
| 0001, 0003, 0005 | Status had never been recorded. Each is treated as ACCEPTED, with a note on which parts are optional or unimplemented.                                                    |
| 0026, 0032–0035  | Still PROPOSED although implemented. Implementation evidence is cited; acceptance is left to the owners.                                                                  |

The full index is in [`adr/README.md`](adr/README.md).

## 6. Plans: status

| Plan                                                  | Classification                                    | Evidence                                                                                |
| ----------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `plans/engineering-backlog-vnext.md`                  | IN PROGRESS (plan of record)                      | Per-story markers in the file; Phase-1: S1–S4 and S8 ✅, S5 and S6 partial, S7 pending  |
| `plans/implementation-blueprint-vnext.md`             | ACTIVE (frozen baseline)                          | —                                                                                       |
| `plans/architecture-vnext-design.md`                  | PARTIALLY SUPERSEDED                              | Its repository layout was not adopted ([ADR-0013](adr/0013-model-gateway-evolution.md)) |
| `plans/architecture-review-vnext.md`                  | REFERENCE                                         | —                                                                                       |
| June 2026 Advanced Agent OS and Unified Product plans | SUPERSEDED by ROADMAP + vNext backlog (detached)  | The packages they describe exist; individual tasks **not** re-verified                  |
| Phase K, P1–P14, L6 priority docs; `23-roadmap`       | SUPERSEDED by [ROADMAP.md](ROADMAP.md) (detached) | Releases shipped per CHANGELOG; open items **not** individually re-verified             |

[`ROADMAP.md`](ROADMAP.md) consolidates open work. It keeps the existing IDs (T-0xx, CQ-0xx, R-0x, vNext story IDs) and marks each item OPEN, PARTIAL, FIXED or UNVERIFIED, citing evidence for every item marked OPEN, PARTIAL or FIXED.

## 7. Remaining documentation gaps

- **Brief docs.** Several numbered docs are still only 5–18 lines: `04`, `08`, `11`, `15`, `16`, `17`, `18`, `19`, `20`, `22`. They are marked _brief_ in the index and were not expanded.
- **Language.** The audit reports (phases 1–4) are largely in Indonesian. The public docs are English.
- **Numbered reference docs** (`25`–`49`, `71`–`78`) were checked only for positioning, plugin claims and links. Their detailed claims were not re-verified line by line.
- **Code-embedded doc strings to update.** These are code changes, so they were not done here:
  - The CLI help banner says "Local-First AI Agent Operating System" (`apps/cli`).
  - `packages/harness/src/config-loader.ts` points scaffolded `defaults.yaml` at the detached `docs/plans/2026-06-19-002-…` path.
- **Inconsistencies found and not fixed (code or config):**
  - `.env.example` sets `GATEWAY_PORT`, but the code reads `ANVIO_GATEWAY_PORT`.
  - Root `package.json` is at version 2.3.0, while the CHANGELOG and the old README say 2.10.0.
  - `anvio init` prints "run: anvio run architect", but it creates no agent.
  - A CLI run whose persona is missing leaves the session `idle` instead of `failed`.
- **R-07:** the agent body vs persona prompt behaviour needs an owner decision. The docs describe the current behaviour.

## 8. AI context exclusion mechanisms configured

Seven layers were put in place:

1. **Physical separation:** `docs/_detached/`.
2. **Navigation:** the active index links only to `_detached/README.md` and `MANIFEST.md`, as an archive pointer. No active document links into detached content, apart from CHANGELOG history links.
3. **Indexing exclusions:** see the table.
4. **Agent instructions:** in every instruction file the repository already had.
5. **Allow-list:** `docs/README.md` is named as the authoritative index in every instruction file.
6. **A banner** in `_detached/README.md`.
7. **A manifest.**

| Tool               | Mechanism                                                                                        | What it enforces                                                                                                                                                                                                                                                    | What it does not                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code        | `.claude/settings.json` → `permissions.ask: Read(./docs/_detached/**)`, `Edit(…)`                | Prompts for approval before the Read/Edit tools, or recognised file commands such as `cat`/`head`, touch detached files. This holds even in bypass mode (Claude Code docs). `ask` was chosen over `deny` so that a user-requested historical review stays possible. | Does not hide files from `grep -r`/`find` output, nor from subprocesses. **Not observed active in the session that created it**: a Read succeeded without a prompt, probably because settings load at session start. Verify in a new session. |
| Claude Code        | `CLAUDE.md` "Documentation authority"                                                            | Instruction                                                                                                                                                                                                                                                         | Advisory only                                                                                                                                                                                                                                 |
| Cursor             | `.cursorindexingignore` (`docs/_detached/`)                                                      | Excluded from the codebase index and semantic search                                                                                                                                                                                                                | Files remain readable via @-mention, the terminal or MCP. `.cursorignore` was deliberately not used, because it would block even explicit historical reads.                                                                                   |
| Cursor             | `.cursor/rules/documentation-authority.mdc` (`alwaysApply`)                                      | Instruction                                                                                                                                                                                                                                                         | Advisory                                                                                                                                                                                                                                      |
| Windsurf / Codeium | `.codeiumignore` (`docs/_detached/`); `.windsurf/rules/documentation-authority.md` (`always_on`) | Index exclusion; instruction                                                                                                                                                                                                                                        | Explicit reads not blocked. Not tested in Windsurf.                                                                                                                                                                                           |
| GitHub Copilot     | `.github/copilot-instructions.md` policy                                                         | Instruction                                                                                                                                                                                                                                                         | Copilot content exclusion is configured in GitHub repository or organisation settings, not by a repository file. **Not configured**; an owner action is needed.                                                                               |
| Generic agents     | `AGENTS.md` policy                                                                               | Instruction                                                                                                                                                                                                                                                         | Advisory                                                                                                                                                                                                                                      |

**Complete exclusion is not claimed.** Any agent can still read detached files through shell commands or direct paths. Only Claude Code's `ask` rule adds a hard gate, and only for its own recognised tools.

## 9. Validation results

| Check                                    | Result                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal links and anchors               | Custom checker (file existence plus GitHub-style heading anchors, fenced code ignored) over all `*.md` outside `node_modules`/`dist`. **Baseline `main`: 221 files, 0 broken. After: 231 files, 0 broken.**                                                                                                                                   |
| Links from active docs into `_detached/` | Only the archive pointers (`docs/README.md`, `docs/plans/README.md`) and CHANGELOG history                                                                                                                                                                                                                                                    |
| Code-referenced doc paths                | All exist, except the harness template comment (§7)                                                                                                                                                                                                                                                                                           |
| README commands                          | Every `anvio <command>` in the README appears in `anvio --help`                                                                                                                                                                                                                                                                               |
| Quick Start                              | The README snippet was extracted and executed verbatim in a temporary directory, with no API key: `init` → persona + agent → `workspace validate` → `agents list` → `run assistant "Say hello"` produced `[Mock — set a model API key] You said: Say hello`, session `completed`. The repository sample workspace (`architect`) was also run. |
| Gateway defaults                         | `127.0.0.1:3001` and `/health` confirmed in code (`unified-gateway.ts`) and by the E2E test GW-01                                                                                                                                                                                                                                             |
| Mermaid                                  | **No parser run** (none installed; installing mermaid-cli would download Chromium). The diagrams were reviewed by hand against flowchart and sequence syntax: quoted labels, valid edge forms (`-->`, `-. text .->`). Render them on GitHub to confirm.                                                                                       |
| Markdown formatting                      | Prettier over the new and edited Markdown (see §10)                                                                                                                                                                                                                                                                                           |
| `.claude/settings.json`                  | Valid JSON                                                                                                                                                                                                                                                                                                                                    |
| Secrets                                  | None added; examples use `${VAR}` references and `...` placeholders                                                                                                                                                                                                                                                                           |
| Historical documents lost                | None. 27 moved with history, 1 README copy, 0 deleted                                                                                                                                                                                                                                                                                         |

### README claim verification (internal)

| Claim                                                             | Evidence                                                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18 model providers                                                | `packages/models/src/provider-catalog.ts` (15 OpenAI-compatible ids) + `provider-factory.ts` (`anthropic`, `gemini`, `custom`); `anvio routing providers` lists 17 + custom |
| 15 channel adapters                                               | `packages/channels/src/*.ts`; `channelsConfigSchema` in `packages/core/src/schemas/workspace.schema.ts`                                                                     |
| About 75 built-in tools                                           | 75 `case` handlers in `packages/tools/src/builtins/index.ts`                                                                                                                |
| Tool loop with 5 rounds by default                                | `DEFAULT_MAX_TOOL_ITERATIONS = 5`, `packages/agents/src/tool-round.ts`                                                                                                      |
| Per-session serialisation and global cap                          | `KeyedSerialQueue` + `Semaphore` in `packages/platform/src/gateway-worker.ts`; post-refactoring LOAD-01/02                                                                  |
| Delegation depth 3, mixture up to 8                               | `packages/platform/src/delegation-depth.ts` and its spec                                                                                                                    |
| A2A server, Agent Card paths, `/a2a` on the gateway               | `packages/a2a/src/server/a2a-server.ts`; `packages/platform/src/gateway-http.ts` (A2A routes)                                                                               |
| A2A client gaps                                                   | `packages/a2a/src/client/a2a-client.ts` (no auth in `ClientFactory`); `anvio-agent-executor.ts` `cancelTask`                                                                |
| A2A auth off, push on by default                                  | `a2aConfigSchema` defaults                                                                                                                                                  |
| `a2a_delegate`, `mcp_manage`, `delegate_task` disabled by default | `packages/core/src/schemas/tool-gateway.schema.ts`                                                                                                                          |
| MCP stdio NDJSON and HTTP; official-SDK conformance               | `packages/integrations/src/mcp-{stdio,http}-client.ts`; E2E MCP-01..05                                                                                                      |
| MCP and hook environment inheritance (gap)                        | `mcp-stdio-client.ts` (`...process.env`); `packages/hooks/src/handlers/script.ts` (`env: process.env`)                                                                      |
| Egress policy, private networks blocked                           | `DEFAULT_EGRESS_POLICY` in `packages/tools/src/builtins/egress.ts`                                                                                                          |
| Loopback bind; 1 MB body cap                                      | `unified-gateway.ts` (`127.0.0.1`); `gateway-http.ts` `MAX_REQUEST_BODY_BYTES`                                                                                              |
| Invalid `anvio.yaml` fails startup                                | `Workspace.open`, `packages/workspace/src/index.ts`; `workspace-open.spec.ts`                                                                                               |
| Runtimes; Daytona/Modal exec-only                                 | `packages/runtimes/src/runtime-factory.ts`; `remote/remote-runtime-stub.ts` (`run`/`stream` throw)                                                                          |
| Memory providers; Qdrant stub                                     | `packages/memory/src/providers/{sqlite,honcho,gbrain}`; `provider-factory.ts` `case 'qdrant'` → stub                                                                        |
| Persona body is the system prompt; persona must exist             | Quick Start run (`Persona not found: assistant` without it); E2E harness `personaMd`                                                                                        |
| Session states                                                    | `AgentRunStatus` in `packages/core/src/types/common.ts`                                                                                                                     |
| No plugin system                                                  | No `plugin` identifier in `packages/*/src` or `apps/*/src`; audit phase 3, doc 03                                                                                           |
| CI jobs                                                           | `.github/workflows/ci.yml` (lint, build-typecheck, test on Node 22 and 24, audit)                                                                                           |
| Deployment files                                                  | `docker/Dockerfile.{api,gateway,worker}`, `docker/docker-compose{,.dev}.yml`; no Kubernetes or Helm files                                                                   |
| MIT license                                                       | `LICENSE`                                                                                                                                                                   |

## 10. Limitations and follow-up actions

**Limitations of this pass:**

- **Mermaid:** syntax was not machine-validated.
- **Claude Code `ask` rule:** not observed working in the creating session.
- **Windsurf and Cursor exclusions:** not exercised in those tools.
- **Builds and tests:** not re-run. Only Markdown and agent configuration changed, and the disk was nearly full during most of this work.

**Follow-up actions:**

_Owner decisions_

1. Accept or reject the implemented PROPOSED ADRs (0026, 0032, 0033, 0035) and ADR-0039. Decide ADR-0004.
2. Decide R-07: should the agent Markdown body become the system prompt, or be documented as description only?

_Owner configuration and checks_ 3. Configure GitHub Copilot content exclusion for `docs/_detached/**` in the repository settings. 4. Open a new Claude Code session and confirm that reading `docs/_detached/**` prompts for approval.

_Code changes (small, user-visible)_ 5. Update the CLI banner and package descriptions (ADR-0038). 6. Fix `.env.example` (`GATEWAY_PORT` → `ANVIO_GATEWAY_PORT`). 7. Make `anvio init` scaffold a sample agent and persona, or stop suggesting `anvio run architect`. 8. Point the `packages/harness` template comment at `docs/41-channel-harness.md`.

_Documentation_ 9. Expand the _brief_ docs, and re-verify the deep reference docs (`25`–`49`) claim by claim. 10. Consider the repo-wide Prettier pass (CQ-017) and adding a link check to CI. The checker used here is ~100 lines of Node with no dependencies and could live in `scripts/`.
