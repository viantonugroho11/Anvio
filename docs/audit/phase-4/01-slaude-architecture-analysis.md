# 01 — Analisis Arsitektur Slaude

## 1. Identitas yang diaudit

| Item    | Nilai                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo    | `github.com/barockok/slaude`                                                                                                                                                                                                                                                   |
| Commit  | `7d2246970f343453dd3314c823099480f9f2f376` (2026-10-19)                                                                                                                                                                                                                        |
| Versi   | `0.45.0-rc.9` (`package.json`), tag `v0.45.0-rc.9`                                                                                                                                                                                                                             |
| Lisensi | MIT                                                                                                                                                                                                                                                                            |
| Ukuran  | 1215 file; ±50k baris TS di `src/` (tanpa web UI)                                                                                                                                                                                                                              |
| Stack   | Bun + TypeScript; `@anthropic-ai/claude-agent-sdk`, `@slack/bolt`, `bullmq`/`ioredis`, PGLite/Postgres/sqlite                                                                                                                                                                  |
| Metode  | Clone read-only ke scratchpad audit; source dibaca langsung. **Kode dan test Slaude tidak dijalankan** (repo pihak ketiga; butuh Bun). Klaim dari `CLAUDE.md`/field notes Slaude hanya dipakai sebagai petunjuk lalu diverifikasi ke source; yang tidak diverifikasi ditandai. |

## 2. Lingkup produk

`CLAUDE.md` Slaude: "Slack-native Claude Code runtime… Slack integration only… Out: Discord, Teams, web chat, CLI UX." Satu deploy = satu persona/`SOUL.md` (multi-agent via multi-deploy atau persona di gateway). Mesin agent = **Claude Agent SDK** (CLI Claude Code sebagai child process).

Anvio sebaliknya: platform multi-channel (15 adapter), multi-runtime (loop lokal + vendor), multi-provider (18 provider), A2A, workflow, goals, dsb. Perbandingan di dokumen berikut hanya pada kapabilitas yang setara.

## 3. Peta komponen (dari source)

| Area                 | Lokasi Slaude                                                                          | Inti                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Entry & topologi     | `src/server.ts`, `src/config/env.ts:309-311`                                           | `SLAUDE_ROLE` = `mono` (default) \| `gateway` \| `node`                                                                      |
| Agent runtime        | `src/agent/manager.ts` (1725 baris)                                                    | `AgentManager extends EventEmitter`, `Map<sessionId, LiveSession>`, `agentSdk.query()` per sesi, idle TTL, resume, hooks SDK |
| Child env            | `src/agent/child-env.ts`                                                               | `scrubChildEnv` (denylist variabel gateway-only + key embedding + Redis/node token)                                          |
| Gateway              | `src/gateway/core/gateway.ts` (3334 baris)                                             | Event Slack → dedup durable → engagement/slash → dispatch turn                                                               |
| Transport Slack      | `src/gateway/slack/*`                                                                  | Socket Mode (mono) atau HTTP Events API (gateway HA), Block Kit, format mrkdwn                                               |
| Izin per-tool        | `src/gateway/slack/permission-gate.ts`                                                 | `canUseTool` SDK → kebijakan statis → kartu Approve/Deny durable                                                             |
| Approval per-rencana | `src/gateway/slack/approval-gate.ts`                                                   | Tool `request_approval` dipanggil agent → kartu dengan daftar approver dari SOUL                                             |
| Soul                 | `src/soul/loader.ts`, `extract.ts`                                                     | `RUNTIME_BASELINE` hard-coded + `SOUL.md` operator; ekstraksi LLM → zod → grounding ID → cache ber-HMAC                      |
| Sesi                 | `src/db/sessions.ts`, `migrations/0002_sessions.sql`                                   | Unik `(team, channel, thread_ts, persona)`; `claude_started` untuk resume; `engaged`                                         |
| Antrean              | `src/queue/turns.ts`, `locks.ts`, `reaper.ts`, `registry.ts`                           | BullMQ per label node; lock sesi `SET NX PX` + Lua; coalescing; reaper                                                       |
| Node worker          | `src/node/worker.ts`, `src/node/shims/permission.ts`                                   | Menjalankan `AgentManager`, izin via REST long-poll ke gateway                                                               |
| Skills               | `src/skills/*`, `src/tools/contracts/skills.ts`                                        | `~/.slaude/skills/<slug>/SKILL.md`; MCP `list/read/write/delete_skill`, `sync_manifest` (push git)                           |
| Knowledge / brain    | `src/knowledge/*`                                                                      | gbrain (PGLite/Postgres), scope per agent/user, write gated, KB ingest                                                       |
| Memory               | `src/memory/*`                                                                         | `prefetch` → `<memory-context>`; `syncTurn` pasca-turn                                                                       |
| Plugin               | `src/config/plugins.ts`, `src/cli/install.ts`                                          | Plugin Claude Code (marketplace) via `slaude.json` + `slaude.lock` (pin SHA), dimuat lewat `Options.plugins`                 |
| Deploy               | `Dockerfile`, `docker-compose*.yaml`, `deploy/k8s*`, `src/health.ts`, `src/metrics.ts` | `/healthz`, `/readyz`, `/metrics` (Prometheus), k8s HA + HPA                                                                 |
| Simulasi             | `src/gateway/sim/*`                                                                    | Simulator gateway (REPL/TUI/scenario), fake Slack wire-level untuk e2e                                                       |

## 4. Alur turn (mode gateway + node)

```mermaid
sequenceDiagram
  autonumber
  participant SL as Slack
  participant GW as Gateway (gateway.ts)
  participant DB as DB (seen_events, sessions, pending_gates)
  participant Q as BullMQ (Redis)
  participant N as Node worker
  participant M as AgentManager
  participant SDK as Claude Agent SDK (CLI child)
  SL->>GW: event (Socket Mode / HTTP)
  GW->>DB: SeenEvents.tryInsert(channel:ts) — dedup atomik
  GW->>GW: engagement / mention-only / slash command
  GW->>DB: findByThread / createForThread
  GW->>Q: enqueue turn (coalesce bila job pending)
  N->>Q: claim job (+ session lock SET NX PX)
  N->>M: pushUser(text) atau boot query({resume})
  M->>SDK: query(prompt iterable, options{canUseTool, hooks, mcpServers, env: scrubbed})
  SDK-->>M: tool call → canUseTool
  M->>GW: /v1 can_use_tool (long-poll pending)
  GW->>DB: pending_gates row; post kartu
  SL->>GW: klik Approve/Deny
  GW->>DB: guarded UPDATE status='pending'→approved
  GW-->>M: keputusan (gate bus)
  SDK-->>M: result
  M->>SL: reply via MCP surface tool
```

## 5. Yang SDK sediakan vs yang Slaude bangun

| Kapabilitas                       | Dari Claude Agent SDK/CLI          | Dibangun Slaude                                                               |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Loop penalaran & tool loop        | ✔                                  | —                                                                             |
| Kompaksi context                  | ✔ (auto-compact)                   | Hook `PreCompact` untuk notifikasi; `token-budget.ts` threshold warn/critical |
| Resume transkrip                  | ✔ (`resume`/session id)            | Pemetaan thread→sesi, `claude_started`, retry resume-miss                     |
| Tool built-in (Bash, Edit, …)     | ✔                                  | Alias ke remote exec (`/remote`), deny lokal via `PreToolUse`                 |
| MCP client                        | ✔ (CLI)                            | Merge server per persona, bridge kredensial di gateway, OAuth connect         |
| Permission callback               | ✔ (`canUseTool`, `permissionMode`) | Kebijakan, kartu Slack, durable gate, approver dari SOUL                      |
| Plugin CC (skills/commands/hooks) | ✔ (`Options.plugins`)              | Instalasi via manifest + lock, workaround `.mcp.json` plugin                  |
| Skill invocation `/skill`         | ✔ (format SKILL.md CC)             | MCP write/delete skill, auto-evolve prompt, push ke git                       |
| Gateway, antrean, HA, Slack       | —                                  | ✔ seluruhnya                                                                  |
