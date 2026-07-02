# Post P11 Gap Register — v1.17.0 → Roadmap P12+

**Baseline:** v1.17.0 (Phase P11a–P11d shipped — **71 built-in gateway tools**)  
**Tanggal review:** 2026-06-19  
**Referensi:** [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) · [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) · [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md)

---

## Ringkasan eksekutif

| Referensi | Parity v1.15 | Parity v1.17 | Catatan |
|-----------|--------------|--------------|---------|
| **Hermes Agent** | ~80% | **~93%** | Tool breadth ✅; depth + platform bundles via MCP |
| **slaude** | ~88% | **~94%** | Harness + connections ✅; Slack-native flows partial |
| **Core dev workflow** | ~75% | **~97%** | file/web/browser/terminal/kanban/MoA/HA gateway |

**P11 menutup:** tool gateway 12 → 71, OTel, planner CLI, browser session, kanban agent tools, orchestration (`delegate_task`, `cronjob`, `skills_*`, `send_message`), niche integrations (HA, x_search, MoA, MCP presets).

**Yang tersisa:** bukan “tools count” lagi — fokus ke **depth**, **channel production**, **remote runtime**, **slaude-native UX**, dan **research/observability**.

---

## Legenda

| Simbol | Arti |
|--------|------|
| ✅ | Parity / production-ready |
| 🟡 | Scaffold / partial |
| ❌ | Belum ada |
| MCP | Sengaja via MCP server, bukan duplicate gateway key |
| 🔵 | Keunggulan Anvio |

---

## 1. Tools — residual (post-71 keys)

Gateway **breadth** ≈ Hermes `hermes-cli`. Gap tersisa = **sub-tools**, **depth**, **live MCP**.

| # | Gap | Hermes | Anvio v1.17 | Target phase |
|---|-----|--------|-------------|--------------|
| T1a | Spotify bundle (7 tools) | ✅ | 🟡 `spotify_search` + MCP preset | **P12** — test + doc MCP spotify |
| T1b | Feishu doc/drive (5 tools) | ✅ | 🟡 `feishu_doc_read` + MCP preset | **P12** |
| T1c | Yuanbao (`yb_*`, 5 tools) | ✅ | ❌ | **P12** — MCP plugin or defer |
| T1d | RL (`rl_*`, 10 tools) | ✅ | ✅ `rl_tool` action + MCP preset + direct Tinker-Atropos HTTP fallback (`ATROPOS_API_URL`) + mock mode | Live training loop trigger done; MCP preset E2E still optional |
| T1e | `computer_use` (macOS CUA) | ✅ | 🟡 stub/skipped | **P13** or never (headless Linux) |
| T1f | `video_analyze` / `video_generate` | ✅ | 🟡 note/stub | **P12** — MCP video or ffmpeg frames |
| T1g | Full raw `browser_cdp` | ✅ | 🟡 safe allowlist only | **P12** — opt-in CDP grant (slaude-style) |
| T1h | Nous Portal OAuth | ✅ | ✅ `anvio setup-token --nous` (browser 1-click, no vendor CLI) | Model/tools routing off the grant is a follow-up |
| T1i | MCP per-server tool allowlist | ✅ | 🟡 first-call approval only | **P12** — fine-grain filter |
| T1j | Honcho gateway tools (`honcho_*`) | ✅ | 🟡 `@anvio/memory` provider | OK as provider; expose as tools optional |

**Tidak perlu duplicate gateway key** untuk Spotify/Feishu/RL individual — Hermes juga bundle via plugin/MCP. Prioritas: **MCP presets tested E2E**, bukan +18 gateway keys.

---

## 2. Channel & harness

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| C1 | Feishu / SMS channel | ❌ | **P12** per demand |
| C2 | Harness snapshot tests per adapter | 🟡 | **P12** regression |
| C3 | Signal live (signal-cli REST) | 🟡 stub | **P12** |
| C4 | Google Chat service account | 🟡 webhook only | **P12** |
| C5 | Teams / Matrix production hardening | ✅ E2E | **P12** — retry, rate limit, soak tests |
| C6 | Email IMAP IDLE + thread headers | 🟡 poll | **P13** |
| C7 | Harness engagement depth vs Slack-only stacks | 🟡 | **P12** — slaude parity polish |

---

## 3. slaude-specific (masih ~6% gap)

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| SL1 | Slack Agents API status surface | ❌ | **P12** |
| SL2 | Strict global MCP-only output mode | 🟡 per-channel suppress | **P12** |
| SL3 | `/1on1` flow equivalent | ❌ | **P12** |
| SL4 | Full CDP browser grant (login flows) | 🟡 OAuth host ✅ | **P12** — extend `browser_cdp` |
| SL5 | Slack-deep harness (vs multi-channel general) | 🟡 | **P13** optional |

---

## 4. Runtime & infra

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| R1 | SSH remote agent execution | 🟡 connectivity test | **P13** |
| R2 | Daytona serverless | 🟡 stub | **P13** |
| R3 | Modal serverless | 🟡 stub | **P13** |
| R4 | Singularity | ✅ `SingularityRuntimeProvider` + `anvio runtime exec singularity` | Done — local `singularity exec`, mock mode for dev/test |
| R5 | Claude Code / Codex runtime stubs | 🟡 | **P13** — complete or document defer |
| R6 | Desktop app (tray, installer) | ❌ deferred | **P14+** optional |

---

## 5. Voice

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| V1 | CLI STT/TTS | ✅ | — |
| V2 | Telegram / Discord voice hooks | ✅ | — |
| V3 | Real-time streaming STT | ❌ | **P13** WebSocket adapter |
| V4 | Discord full VC | 🟡 audio attach | Deferred |

---

## 6. Observability & research

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| O1 | Trajectory export (Hermes research) | ❌ | **P14** research |
| O2 | Atropos RL training live | 🟡 MCP preset + direct HTTP fallback (`rl_tool`, `ATROPOS_API_URL`) | **P12** — MCP E2E; still needs a real Tinker-Atropos service for a genuinely live run |
| O3 | Langfuse dashboard templates | 🟡 OTel wired | **P12** — importable dashboard JSON |
| O4 | Token audit + Prometheus | ✅ P9–P10 | — |

---

## 7. Automation & authoring (minor)

| # | Gap | Anvio v1.17 | Target |
|---|-----|-------------|--------|
| W1 | Hermes workflow→skill pattern docs | 🟡 | **P12** — example + doc |
| W2 | hermes-tech skill import automation | 🟡 script | **P12** — catalog CI |
| W3 | Cron / planner / batch / DAG | ✅ | — |

---

## 8. Keunggulan Anvio (bukan gap)

| # | Capability |
|---|------------|
| 🔵 | Local-first file workspace, no DB required |
| 🔵 | Advanced Agent OS (goals, kanban, batch, credentials) |
| 🔵 | 18+ model providers + routing |
| 🔵 | Multi-channel harness (not Slack-only) |
| 🔵 | Dual MD + YAML loader |
| 🔵 | Token usage audit + cost estimate |
| 🔵 | 71 gateway tools + MCP bridge + harness channel tools |

---

## Rekomendasi phase (P12+)

### P12 — Integration & polish (recommended next)

**Goal:** Tutup gap operasional post-tool-breadth.

| Track | Deliverables |
|-------|--------------|
| **P12-MCP** | E2E tests untuk presets Spotify, Feishu, Tinker-Atropos; `anvio mcp` setup guide |
| **P12-CH** | Signal bridge, Google Chat SA, harness snapshot tests, Teams/Matrix hardening |
| **P12-SL** | MCP-only mode, `/1on1`-style session flow, Slack status surface |
| **P12-OBS** | Langfuse dashboard template + doc OTLP env |
| **P12-DOC** | Workflow→skill example; update [51](./51-gap-hermes-slaude.md) baseline v1.17 |

**Estimasi impact:** Hermes ~93% → **~96%**, slaude ~94% → **~97%**

### P13 — Remote & voice

| Track | Deliverables |
|-------|--------------|
| **P13-R** | SSH agent exec, Daytona/Modal API integration |
| **P13-V** | Streaming STT adapter |
| **P13-E** | IMAP IDLE, email thread headers |

### P14 — Optional / research

| Track | Deliverables |
|-------|--------------|
| **P14-D** | Desktop shell (`apps/desktop`) |
| **P14-R** | Trajectory export, RL research tooling |
| **P14-T** | Nous Portal OAuth, Singularity |

---

## Success criteria v1.17 (recap — ✅ met)

| Kriteria | Status |
|----------|--------|
| Built-in gateway ≥ Hermes core breadth | ✅ 71 keys |
| Browser Playwright session tools | ✅ P11b–c |
| Kanban agent tools | ✅ P11b–c (9 ops via 9 keys + complete) |
| Orchestration as gateway tools | ✅ P11c–d |
| Home Assistant REST | ✅ P11d |
| MCP delegation pattern | ✅ `callMcpTool` + presets |
| OTel + planner CLI | ✅ P11a |
| Release tagged | ✅ [v1.17.0](https://github.com/viantonugroho11/Anvio/releases/tag/v1.17.0) |

---

## Dokumen terkait

| Doc | Isi |
|-----|-----|
| [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md) | **This file** — gap post-P11 |
| [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) | Master gap register (legacy rows, update baseline) |
| [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) | Tool-by-tool mapping |
| [64](./64-phase-p11a-priorities.md)–[68](./68-phase-p11d-priorities.md) | P11 phase shipped |

Terakhir diperbarui: v1.17.0 (2026-06-19).
