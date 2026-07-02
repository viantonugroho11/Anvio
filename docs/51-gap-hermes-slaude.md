# Gap Register — Hermes + slaude → Anvio

Status baseline: **Phase A–J + P4–P14 + v1.20–v1.21.1 selesai** (72 gateway tools, unified gateway, runtime OAuth chain fallback).  
Referensi: [Hermes Agent](https://hermes-agent.nousresearch.com/docs) · [slaude](https://github.com/barockok/slaude) · [hermes-tech](https://github.com/viantonugroho11/hermes-tech)

**Ringkasan:** arsitektur gabungan production-viable (~**97% Hermes**, ~**98% slaude** as of 2026-07-02).  
**Gap tersisa (dikoreksi 2026-07-02 — P12/P13/P14 sudah shipped, dokumen sebelumnya basi):** [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md).

**Katalog tools Hermes lengkap:** [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md)

---

## Legenda

| Simbol | Arti                                                |
| ------ | --------------------------------------------------- |
| ✅      | Parity / production-ready                           |
| 🟡     | Ada scaffold atau partial; belum setara             |
| ❌      | Belum ada                                           |
| 🔵     | Anvio punya; Hermes/slaude tidak (keunggulan Anvio) |

---

## 1. Tooling & eksekusi

| #   | Gap                                       | Hermes | slaude  | Anvio v1.15.0                                              | Target                             |
| --- | ----------------------------------------- | ------ | ------- | ---------------------------------------------------------- | ---------------------------------- |
| T1  | Built-in tools (60+)                      | ✅      | via MCP | ✅ ~71 gateway tools + MCP — [catalog](./65-hermes-tools-catalog.md) | MCP sub-tool variants (Spotify bundle) |
| T2  | Browser sandbox (Playwright)              | ✅      | —       | ✅ Playwright + fetch fallback                              | —                                  |
| T3  | Image generation                          | ✅      | —       | ✅ DALL-E via OpenAI API                                    | —                                  |
| T4  | Text-to-speech (tool)                     | ✅      | —       | ✅ OpenAI TTS via `@anvio/voice`                           | —                                  |
| T5  | `execute_code` programmatic multi-step    | ✅      | —       | ✅ `execute_code_pipeline`                                  | —                                  |
| T6  | Nous Portal OAuth (1-click model + tools) | ✅      | —       | ✅ `anvio setup-token --nous` (browser callback host, no vendor CLI) | Model/tools routing off the grant is a follow-up |
| T7  | MCP tool filtering / toolsets             | ✅      | ✅       | ✅ bridge + stdio client + first-call approval + health     | Per-server allowlist (fine-tune)   |

---

## 2. Channel & harness

| #   | Gap                                   | Hermes  | slaude     | Anvio v1.15.0                           | Target                                |
| --- | ------------------------------------- | ------- | ---------- | --------------------------------------- | ------------------------------------- |
| C1  | Jumlah platform                       | 20+     | Slack      | ✅ ~13 types (+ Mattermost)             | Feishu, SMS per demand                |
| C2  | Harness depth (engagement, format)    | partial | Slack deep | 🟡 general stack + multi-channel approval | Snapshot tests per adapter            |
| C3  | Harness default on                    | —       | —          | ✅ enabled + regression                  | —                                     |
| C4  | Microsoft Teams live                  | ✅       | —          | ✅ webhook + Bot Framework outbound + Adaptive Card approval | Production hardening          |
| C5  | Matrix live                           | ✅       | —          | ✅ webhook + CS API outbound               | Production hardening                  |
| C6  | Email IMAP/SMTP full                  | ✅       | —          | ✅ SMTP outbound + IMAP poll (worker)    | IMAP IDLE, thread headers             |
| C7  | Signal (signal-cli)                   | ✅       | —          | 🟡 stub                                 | Bridge ke signal-cli REST             |
| C8  | Google Chat                           | ✅       | —          | 🟡 webhook                              | Service account path                  |
| C9  | WhatsApp / Telegram / Discord / Slack | ✅       | partial    | ✅ adapters + harness tests              | Maintain + snapshot tests             |

---

## 3. Soul, policy, connections (slaude core)

| #   | Gap                                | Hermes | slaude        | Anvio v1.15.0               | Target                           |
| --- | ---------------------------------- | ------ | ------------- | --------------------------- | -------------------------------- |
| S1  | SOUL.md identity                   | ✅      | ✅             | ✅ `souls/*/SOUL.md`         | —                                |
| S2  | SOUL.md policy gate                | basic  | ✅ scope-based | ✅ regex + LLM extraction (P8) | —                                |
| S3  | Contextual connections broker      | —      | ✅             | ✅ store + encrypt + CLI       | —                                |
| S4  | CDP / login-host (browser grant)   | —      | ✅             | ✅ local OAuth callback host   | Full CDP browser grant optional  |
| S5  | Per-user connection isolation test | —      | ✅             | ✅ integration tests           | —                                |
| S6  | Workspace manifest import          | —      | ✅             | ✅ `anvio kb import-manifest`  | —                                |

---

## 4. Learning & memory

| #   | Gap                               | Hermes | slaude | Anvio v1.15.0                     | Target                       |
| --- | --------------------------------- | ------ | ------ | --------------------------------- | ---------------------------- |
| L1  | Skill evolution (draft → promote) | ✅      | —      | ✅ `.md` drafts                    | —                            |
| L2  | Memory nudge on session end       | ✅      | —      | ✅                                 | —                            |
| L3  | Honcho provider                   | ✅      | —      | ✅ delegate + dialectic context fetch | —                        |
| L4  | FTS5 cross-session recall         | ✅      | —      | ✅ optional sqlite FTS5            | —                            |
| L5  | LLM periodic summarization        | ✅      | —      | ✅ session-end + cron automation   | —                            |
| L6  | Skill self-improve during use     | ✅      | —      | ✅ runtime hook + auto-promote + native tool_use | —              |
| L7  | Knowledge base raw→wiki           | —      | ✅      | ✅ `@anvio/knowledge`              | —                            |

---

## 5. Runtime & infra

| #   | Gap                           | Hermes  | slaude | Anvio v1.15.0                 | Target                            |
| --- | ----------------------------- | ------- | ------ | ----------------------------- | --------------------------------- |
| R1  | Local runtime                 | ✅       | ✅      | ✅                             | —                                 |
| R2  | Docker runtime                | ✅       | —      | ✅ DockerRuntimeProvider       | —                                 |
| R3  | SSH remote                    | ✅       | —      | 🟡 connectivity test only      | Agent exec over SSH               |
| R4  | Daytona serverless            | ✅       | —      | 🟡 stub                        | API integration                   |
| R5  | Modal serverless              | ✅       | —      | 🟡 stub                        | API integration                   |
| R6  | Singularity                   | ✅       | —      | ✅ `SingularityRuntimeProvider` (local `singularity exec`) | —                    |
| R7  | Cursor / Claude Code / Codex  | partial | —      | ✅ ACP serve + Cursor delegate | Claude Code / Codex stubs remain |
| R8  | Desktop app (installer, tray) | ✅       | —      | ❌ deferred                    | `apps/desktop` optional           |

---

## 6. Voice

| #   | Gap                     | Hermes | slaude | Anvio v1.15.0    | Target                   |
| --- | ----------------------- | ------ | ------ | ---------------- | ------------------------ |
| V1  | CLI STT/TTS             | ✅      | —      | ✅ OpenAI + stub  | —                        |
| V2  | Telegram voice note     | ✅      | —      | ✅ Whisper hook   | —                        |
| V3  | Discord voice / VC      | ✅      | —      | ✅ audio attach   | Full VC deferred         |
| V4  | Real-time streaming STT | ✅      | —      | ❌                | WebSocket stream adapter |

---

## 7. Automation & workflows

| #   | Gap                               | Hermes          | slaude | Anvio v1.15.0               | Target                            |
| --- | --------------------------------- | --------------- | ------ | --------------------------- | --------------------------------- |
| W1  | Cron automations                  | ✅               | —      | ✅                           | —                                 |
| W2  | Blueprint catalog                 | partial         | —      | ✅                           | —                                 |
| W3  | Standalone workflow DAG           | partial         | —      | ✅ `@anvio/workflows`        | —                                 |
| W4  | Hermes “workflow → skill” pattern | ✅               | —      | 🟡 via skills + workflows   | Doc + example                     |
| W5  | Planner PLAN→EXECUTE→REVIEW       | ✅ (hermes-tech) | —      | ✅ `anvio planner run` + yaml config | Workflow→skill example |
| W6  | Batch / parallel jobs             | ✅               | —      | ✅ `@anvio/batch`            | —                                 |

---

## 8. Authoring & workspace (Phase J)

| #   | Gap                      | Hermes     | slaude | Anvio v1.15.0         | Target                  |
| --- | ------------------------ | ---------- | ------ | --------------------- | ----------------------- |
| A1  | Skills `.md`             | ✅          | —      | ✅                     | —                       |
| A2  | SOUL `.md`               | ✅          | ✅      | ✅                     | —                       |
| A3  | Agents `.md`             | profiles   | —      | ✅                     | —                       |
| A4  | Workflows `.md`          | skills ref | —      | ✅ frontmatter DAG     | —                       |
| A5  | Personas `.md`           | —          | —      | ✅ optional MD loader  | —                       |
| A6  | Blueprints / automations | YAML       | —      | YAML (by design)       | Tetap YAML (infra)      |
| A7  | hermes-tech skill port   | ✅          | —      | 🟡 `import-hermes-skills.sh` | Catalog automation |

---

## 9. Observability & research (Hermes-only)

| #   | Gap                           | Hermes       | Anvio v1.15.0                                            |
| --- | ----------------------------- | ------------ | -------------------------------------------------------- |
| O1  | Trajectory export             | ✅            | ❌                                                        |
| O2  | Atropos / RL training         | ✅            | 🟡 MCP preset + direct HTTP fallback (`rl_tool`); live external training run still requires a real Tinker-Atropos service |
| O3  | Langfuse / OTel (hermes-tech) | custom stack | 🟡 OTel wired in worker/api; Langfuse via OTLP env | Dashboard templates |

Token usage: `workspace/audit/tokens.jsonl`, `anvio usage stats`, `GET /api/metrics` (P9–P10).

---

## 10. Keunggulan Anvio (bukan gap)

| #     | Capability                                            | Catatan                                |
| ----- | ----------------------------------------------------- | -------------------------------------- |
| 🔵 P1 | Local-first / file workspace                          | Primary design; Hermes lebih VPS/cloud |
| 🔵 P2 | Tanpa DB wajib                                        | CLI-only path                          |
| 🔵 P3 | Advanced Agent OS (goals, kanban, batch, credentials) | Di luar scope Hermes/slaude            |
| 🔵 P4 | 18+ model providers + routing                         | `@anvio/models`                        |
| 🔵 P5 | Dual MD + YAML loader                                 | Migrasi gradual dari legacy YAML       |
| 🔵 P6 | Multi-channel harness (bukan Slack-only)              | slaude scope lebih sempit              |
| 🔵 P7 | Token usage audit + cost estimate                     | P9–P10                                 |

---

## Prioritas rekomendasi (P12+)

Lihat **[69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md)** untuk roadmap lengkap.

### P12 — Integration & polish (recommended next)

1. **P12-MCP** — E2E Spotify, Feishu, Tinker-Atropos presets
2. **P12-CH** — Signal, Google Chat SA, harness snapshot tests
3. **P12-SL** — MCP-only mode, `/1on1`, Slack status surface
4. **P12-OBS** — Langfuse dashboard templates

### P13 — Remote & voice

1. **R3** — SSH remote agent execution
2. **R4–R5** — Daytona, Modal production
3. **V4** — streaming STT
4. **C6** — IMAP IDLE

### P14 — Optional / research

1. **R8** — desktop shell
2. **O1–O2** — trajectory export, Atropos RL live
3. **T6** — Nous Portal OAuth

---

## Success criteria plan (recap)

| #   | Kriteria                                       | Status             |
| --- | ---------------------------------------------- | ------------------ |
| 1   | Harness soul policy Slack/Telegram/Discord/Web | ✅ (enable harness) |
| 2   | SOUL.md → enforceable policy                   | ✅ + LLM extraction (P8) |
| 3   | No bypass harness output port                  | ✅ when enabled     |
| 4   | Learning loop → skill draft                    | ✅                  |
| 4b  | Runtime tool learning (L6)                       | ✅ v1.7.0           |
| 4c  | LLM skill/session summarizer                     | ✅ v1.7.0           |
| 5   | `web_fetch` without MCP                        | ✅                  |
| 6   | Workflow DAG independent                       | ✅                  |
| 7   | Simulation approval + engagement               | ✅                  |
| 8   | Native tool_use (Anthropic/OpenAI/Gemini)      | ✅ v1.11–v1.12      |
| 9   | MCP agent runtime + stdio                        | ✅ v1.12–v1.13      |
| 10  | Teams/Matrix/Email E2E                           | ✅ v1.13–v1.15      |
| 11  | Token usage audit + metrics                      | ✅ v1.14–v1.15      |

**Initiative G–J:** ✅ selesai. **Phase P4–P10:** ✅ selesai.  
**Parity penuh Hermes + slaude:** ❌ — lihat tabel gap di atas.

---

## Dokumen terkait

- [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md) — **Gap post-P11, roadmap P12+**
- [64-phase-p11a-priorities.md](./64-phase-p11a-priorities.md) — Phase P11a (v1.17.0)
- [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) — katalog ~71 tools Hermes + mapping Anvio
- [63-phase-p10-priorities.md](./63-phase-p10-priorities.md) — Phase P10 (v1.15.0)
- [62-phase-p9-priorities.md](./62-phase-p9-priorities.md) — Phase P9 (v1.14.0)
- [61-phase-p8-priorities.md](./61-phase-p8-priorities.md) — Phase P8 (v1.13.0)
- [56-phase-p3-priorities.md](./56-phase-p3-priorities.md) — Phase P3 (v1.8.0)
- [55-phase-l6-learning-priorities.md](./55-phase-l6-learning-priorities.md) — Phase L6 (v1.7.0)
- [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md) — audit ringkas
- [49-workspace-artifacts.md](./49-workspace-artifacts.md) — konvensi MD vs YAML
- [plans/2026-06-19-002-feat-unified-agent-product-plan.md](./plans/2026-06-19-002-feat-unified-agent-product-plan.md) — plan asli

Terakhir diperbarui: v1.17.0 (2026-06-19).
