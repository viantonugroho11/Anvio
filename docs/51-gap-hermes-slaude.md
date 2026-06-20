# Gap Register — Hermes + slaude → Anvio

Status baseline: **Phase A–J selesai** (Advanced Agent OS + unified product plan).  
Referensi: [Hermes Agent](https://hermes-agent.nousresearch.com/docs) · [slaude](https://github.com/barockok/slaude) · [hermes-tech](https://github.com/viantonugroho11/hermes-tech)

**Ringkasan:** arsitektur gabungan sudah ada (~78% Hermes, ~86% slaude post v1.7). Di bawah ini daftar gap tersisa, diurutkan prioritas.

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


| #   | Gap                                       | Hermes | slaude  | Anvio hari ini                                             | Target                             |
| --- | ----------------------------------------- | ------ | ------- | ---------------------------------------------------------- | ---------------------------------- |
| T1  | Built-in tools (60+)                      | ✅      | via MCP | 🟡 ~8 tools + agent tool loop      | Expand gateway + native tool_use API |
| T2  | Browser sandbox (Playwright)              | ✅      | —       | ✅ Playwright + fetch fallback                              | —                                  |
| T3  | Image generation                          | ✅      | —       | ❌ stub config only                                         | Provider OpenAI/Replicate/etc.     |
| T4  | Text-to-speech (tool)                     | ✅      | —       | ❌ stub config only                                         | Wire ke `@anvio/voice`             |
| T5  | `execute_code` programmatic multi-step    | ✅      | —       | 🟡 stub                                                    | Hermes-style collapse pipeline     |
| T6  | Nous Portal OAuth (1-click model + tools) | ✅      | —       | ❌                                                          | Generic OAuth env; Portal opsional |
| T7  | MCP tool filtering / toolsets             | ✅      | ✅       | ✅ bridge                                                   | Per-server allowlist (fine-tune)   |


---

## 2. Channel & harness


| #   | Gap                                   | Hermes  | slaude     | Anvio hari ini                          | Target                                |
| --- | ------------------------------------- | ------- | ---------- | --------------------------------------- | ------------------------------------- |
| C1  | Jumlah platform                       | 20+     | Slack      | ✅ ~13 types (+ Mattermost)             | Feishu, SMS per demand          |
| C2  | Harness depth (engagement, format)    | partial | Slack deep | 🟡 general stack                        | Snapshot tests per adapter            |
| C3  | Harness default on                    | —       | —          | ✅ enabled + regression           | —                                 |
| C4  | Microsoft Teams live                  | ✅       | —          | 🟡 in-memory + Bot Framework when creds | E2E dengan `TEAMS_`*                  |
| C5  | Matrix live                           | ✅       | —          | 🟡 in-memory + CS API when creds        | E2E dengan `MATRIX_*`                 |
| C6  | Email IMAP/SMTP full                  | ✅       | —          | 🟡 outbound queue                       | Bidirectional mail thread             |
| C7  | Signal (signal-cli)                   | ✅       | —          | 🟡 stub                                 | Bridge ke signal-cli REST             |
| C8  | Google Chat                           | ✅       | —          | 🟡 webhook                              | Service account path                  |
| C9  | WhatsApp / Telegram / Discord / Slack | ✅       | partial    | ✅ adapters ada                          | Maintain + harness tests              |


---

## 3. Soul, policy, connections (slaude core)


| #   | Gap                                | Hermes | slaude        | Anvio hari ini              | Target                           |
| --- | ---------------------------------- | ------ | ------------- | --------------------------- | -------------------------------- |
| S1  | SOUL.md identity                   | ✅      | ✅             | ✅ `souls/*/SOUL.md`         | —                                |
| S2  | SOUL.md policy gate                | basic  | ✅ scope-based | ✅ `@anvio/soul-gate`        | —                                |
| S3  | Contextual connections broker      | —      | ✅             | ✅ store + encrypt + CLI       | —                                |
| S4  | CDP / login-host (browser grant)   | —      | ✅             | ✅ local OAuth callback host   | Full CDP browser grant optional  |
| S5  | Per-user connection isolation test | —      | ✅             | ✅ integration tests           | —                                |
| S6  | slaude.json / manifest import      | —      | ✅             | ❌ optional doc only         | `anvio kb sync --from-slaude`    |


---

## 4.x


| #   | Gap                               | Hermes | slaude | Anvio hari ini                    | Target                       |
| --- | --------------------------------- | ------ | ------ | --------------------------------- | ---------------------------- |
| L1  | Skill evolution (draft → promote) | ✅      | —      | ✅ `.md` drafts                    | —                            |
| L2  | Memory nudge on session end       | ✅      | —      | ✅                                 | —                            |
| L3  | Honcho provider                   | ✅      | —      | ✅ delegate + dialectic context fetch | —                            |
| L4  | FTS5 cross-session recall         | ✅      | —      | ✅ optional sqlite FTS5                | —                            |
| L5  | LLM periodic summarization        | ✅      | —      | ✅ session-end LLM + rules fallback | Scheduled cron job (P3)     |
| L6  | Skill self-improve during use     | ✅      | —      | ✅ runtime hook + auto-promote       | Native tool_use API optional |
| L7  | Knowledge base raw→wiki           | —      | ✅      | ✅ `@anvio/knowledge`              | —                            |


---

## 5. Runtime & infra


| #   | Gap                           | Hermes  | slaude | Anvio hari ini                | Target                            |
| --- | ----------------------------- | ------- | ------ | ----------------------------- | --------------------------------- |
| R1  | Local runtime                 | ✅       | ✅      | ✅                             | —                                 |
| R2  | Docker runtime                | ✅       | —      | ✅ DockerRuntimeProvider      | —                                 |
| R3  | SSH remote                    | ✅       | —      | 🟡 connectivity test only     | Agent exec over SSH               |
| R4  | Daytona serverless            | ✅       | —      | 🟡 stub                       | API integration                   |
| R5  | Modal serverless              | ✅       | —      | 🟡 stub                       | API integration                   |
| R6  | Singularity                   | ✅       | —      | ❌                             | Low priority                      |
| R7  | Cursor / Claude Code / Codex  | partial | —      | ✅ ACP serve + Cursor delegate | Claude Code / Codex stubs remain |
| R8  | Desktop app (installer, tray) | ✅       | —      | ❌ U38 deferred                | `apps/desktop` optional           |


---

## 6. Voice


| #   | Gap                     | Hermes | slaude | Anvio hari ini   | Target                   |
| --- | ----------------------- | ------ | ------ | ---------------- | ------------------------ |
| V1  | CLI STT/TTS             | ✅      | —      | ✅ OpenAI + stub | —                        |
| V2  | Telegram voice note     | ✅      | —      | ✅ Whisper hook  | —                        |
| V3  | Discord voice / VC      | ✅      | —      | ✅ audio attach  | Full VC deferred         |
| V4  | Real-time streaming STT | ✅      | —      | ❌                | WebSocket stream adapter |


---

## 7. Automation & workflows


| #   | Gap                               | Hermes          | slaude | Anvio hari ini              | Target                            |
| --- | --------------------------------- | --------------- | ------ | --------------------------- | --------------------------------- |
| W1  | Cron automations                  | ✅               | —      | ✅                           | —                                 |
| W2  | Blueprint catalog                 | partial         | —      | ✅                           | —                                 |
| W3  | Standalone workflow DAG           | partial         | —      | ✅ `@anvio/workflows`        | —                                 |
| W4  | Hermes “workflow → skill” pattern | ✅               | —      | 🟡 via skills + workflows   | Doc + example                     |
| W5  | Planner PLAN→EXECUTE→REVIEW       | ✅ (hermes-tech) | —      | 🟡 blueprints + automations | `configs/planner.yaml` equivalent |
| W6  | Batch / parallel jobs             | ✅               | —      | ✅ `@anvio/batch`            | —                                 |


---

## 8. Authoring & workspace (Phase J)


| #   | Gap                      | Hermes     | slaude | Anvio hari ini    | Target                  |
| --- | ------------------------ | ---------- | ------ | ----------------- | ----------------------- |
| A1  | Skills `.md`             | ✅          | —      | ✅                 | —                       |
| A2  | SOUL `.md`               | ✅          | ✅      | ✅                 | —                       |
| A3  | Agents `.md`             | profiles   | —      | ✅                 | —                       |
| A4  | Workflows `.md`          | skills ref | —      | ✅ frontmatter DAG | —                       |
| A5  | Personas `.md`           | —          | —      | ✅ optional MD loader | —                       |
| A6  | Blueprints / automations | YAML       | —      | YAML (by design)  | Tetap YAML (infra)      |
| A7  | hermes-tech skill port   | ✅          | —      | 🟡 manual copy    | Import script / catalog |


---

## 9. Observability & research (Hermes-only)


| #   | Gap                           | Hermes       | Anvio hari ini                                           |
| --- | ----------------------------- | ------------ | -------------------------------------------------------- |
| O1  | Trajectory export             | ✅            | ❌                                                        |
| O2  | Atropos / RL training         | ✅            | ❌                                                        |
| O3  | Langfuse / OTel (hermes-tech) | custom stack | 🟡 `@anvio/observability` package exists, wiring partial |


---

## 10. Keunggulan Anvio (bukan gap)


| #     | Capability                                            | Catatan                                |
| ----- | ----------------------------------------------------- | -------------------------------------- |
| 🔵 P1 | Local-first / file workspace                          | Primary design; Hermes lebih VPS/cloud |
| 🔵 P2 | Tanpa DB wajib                                        | CLI-only path                          |
| 🔵 P3 | Advanced Agent OS (goals, kanban, batch, credentials) | Di luar scope Hermes/slaude            |
| 🔵 P4 | 18+ model providers + routing                         | `@anvio/models`                        |
| 🔵 P5 | Dual MD + YAML loader                                 | Migrasi gradual dari legacy YAML       |


---

## Prioritas rekomendasi (Phase K+)

> **Utamakan lima pilar** — lihat [52-phase-k-priorities.md](./52-phase-k-priorities.md).

### P0 — Learning, Automation, Authoring, Tooling, Runtime

1. **Learning & memory (L3–L6)** — summarizer, recall index, tool-use skill drafts, Honcho depth
2. **Automation & workflows (W4–W5)** — planner PLAN→EXECUTE→REVIEW, workflow→skill examples
3. **Authoring Phase J (A5, A7)** — personas `.md`, hermes-tech import
4. **Tooling (T1–T5)** — file_read/write, execute_code sandbox, browser next
5. **Runtime (R2, R7)** — Docker first-class, ACP production path

### P1 — harness & connections (setelah P0)

1. **C3** — enable harness + regression suite
2. **S4–S5** — contextual connections CDP + isolation tests

### P2 — breadth

1. **C1** — Mattermost + demand-driven channels
2. **V2–V3** — voice on Telegram/Discord
3. **L4** — FTS5 sqlite recall

### P3 — optional

1. **R8** — desktop shell
2. **O1–O2** — research / RL export
3. **T6** — Nous Portal

---

## Success criteria plan (recap)


| #   | Kriteria                                       | Status             |
| --- | ---------------------------------------------- | ------------------ |
| 1   | Harness soul policy Slack/Telegram/Discord/Web | ✅ (enable harness) |
| 2   | SOUL.md → enforceable policy                   | ✅                  |
| 3   | No bypass harness output port                  | ✅ when enabled     |
| 4   | Learning loop → skill draft                    | ✅                  |
| 4b  | Runtime tool learning (L6)                       | ✅ v1.7.0           |
| 4c  | LLM skill/session summarizer                     | ✅ v1.7.0           |
| 5   | `web_fetch` without MCP                        | ✅                  |
| 6   | Workflow DAG independent                       | ✅                  |
| 7   | Simulation approval + engagement               | ✅                  |


**Initiative G–J:** ✅ selesai.  
**Parity penuh Hermes + slaude:** ❌ — lihat tabel gap di atas.

---

## Dokumen terkait

- [55-phase-l6-learning-priorities.md](./55-phase-l6-learning-priorities.md) — Phase L6 (v1.7.0)
- [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md) — audit ringkas
- [49-workspace-artifacts.md](./49-workspace-artifacts.md) — konvensi MD vs YAML
- [plans/2026-06-19-002-feat-unified-agent-product-plan.md](./plans/2026-06-19-002-feat-unified-agent-product-plan.md) — plan asli

Terakhir diperbarui: v1.7.0 Phase L6 (2026-06-19).