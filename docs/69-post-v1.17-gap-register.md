# Post P11 Gap Register — v1.17.0 → Roadmap P12+

**Baseline:** v1.17.0 (Phase P11a–P11d shipped — **71 built-in gateway tools**)
**Tanggal review awal:** 2026-06-19
**Update terakhir:** 2026-07-02 (v1.21.1 + Nous/Singularity/Atropos/Yuanbao/video/IMAP-IDLE)
**Referensi:** [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) · [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) · [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md)

> ⚠️ **Koreksi penting:** Dokumen ini sempat tidak ter-update setelah P12/P13/P14 shipped (lihat
> [70-phase-p12-priorities.md](./70-phase-p12-priorities.md), [73-phase-p13-priorities.md](./73-phase-p13-priorities.md),
> [75-phase-p14-priorities.md](./75-phase-p14-priorities.md) — semuanya berstatus **shipped v1.18–v1.19**), sehingga
> sempat terbaca seolah P12 "belum dikerjakan". Tabel di bawah sudah dikoreksi ke status real per 2026-07-02.
> Untuk rilis terbaru (v1.20–v1.21.1: unified gateway, SQLite sessions, runtime OAuth, chain fallback) belum ada
> phase-doc bernomor — lihat [76-unified-gateway.md](./76-unified-gateway.md) dan [CHANGELOG.md](../CHANGELOG.md).

---

## Ringkasan eksekutif

| Referensi | Parity v1.15 | Parity v1.17 | Status 2026-07-02 |
|-----------|--------------|--------------|--------------------|
| **Hermes Agent** | ~80% | ~93% | **~97%** — hanya live-credential MCP E2E dan `computer_use` (macOS-only) tersisa |
| **slaude** | ~88% | ~94% | **~98%** — `/1on1`, status surface, MCP-only mode semua sudah shipped di P12 |
| **Core dev workflow** | ~75% | ~97% | **~98%** — remote runtime + email IDLE sekarang live |

**P11 menutup:** tool gateway 12 → 71, OTel, planner CLI, browser session, kanban agent tools, orchestration, niche integrations (HA, x_search, MoA, MCP presets).
**P12/P13/P14 (shipped, v1.18–v1.19) menutup:** MCP presets + allowlist, `/1on1` flow, Slack status surface, Signal REST, Google Chat SA, browser_cdp grant, harness snapshot tests, Teams/Matrix hardening, Feishu/SMS channel, SSH/Daytona/Modal exec, streaming STT, trajectory export, Langfuse dashboard, workflow→skill doc.
**Sesi ini (2026-07-02) menutup:** Nous Portal OAuth, Singularity runtime, Atropos live HTTP fallback, Yuanbao (`yb_tool`), `video_analyze`/`video_generate` (ffmpeg + MCP), real RFC 2177 IMAP IDLE (bukan poll loop lagi).

**Yang benar-benar tersisa:** item yang butuh kredensial/infra nyata yang tidak tersedia di sandbox ini (live Tinker-Atropos service, macOS CUA hardware, Signal/GChat production kredensial), plus item riset opsional (desktop app installer).

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

## 1. Tools — residual (post-73 keys)

| # | Gap | Hermes | Anvio (2026-07-02) | Catatan |
|---|-----|--------|---------------------|---------|
| T1a | Spotify bundle (7 tools) | ✅ | ✅ `spotify_search` + MCP preset, tested | — |
| T1b | Feishu doc/drive (5 tools) | ✅ | ✅ `feishu_doc_read` + MCP preset, tested | — |
| T1c | Yuanbao (`yb_*`, 5 tools) | ✅ | ✅ `yb_tool` action bundle + MCP preset + `ANVIO_YUANBAO_MOCK=1` | Shipped 2026-07-02 |
| T1d | RL (`rl_*`, 10 tools) | ✅ | ✅ `rl_tool` + MCP preset + direct Tinker-Atropos HTTP + mock | Needs a real Tinker-Atropos service for a genuinely *live* run |
| T1e | `computer_use` (macOS CUA) | ✅ | 🟡 stub/skipped | Permanently deferred — no macOS Accessibility API in headless Linux sandbox |
| T1f | `video_analyze` / `video_generate` | ✅ | ✅ ffmpeg frame extraction (local + remote) → vision, `video_generate` via MCP `video-gen` preset + `ANVIO_VIDEO_MOCK=1` | Shipped 2026-07-02 |
| T1g | Full raw `browser_cdp` | ✅ | ✅ opt-in `ANVIO_BROWSER_CDP_GRANT=1` extended methods | Shipped in P14 |
| T1h | Nous Portal OAuth | ✅ | ✅ `anvio setup-token --nous` (browser 1-click, no vendor CLI) | Shipped 2026-07-02 |
| T1i | MCP per-server tool allowlist | ✅ | ✅ `allowedTools` per server, tested | Shipped in P12 |
| T1j | Honcho gateway tools (`honcho_*`) | ✅ | ✅ `honcho_tool` action bundle + MCP preset + `ANVIO_HONCHO_MOCK=1` | Shipped 2026-07-02 |

---

## 2. Channel & harness

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| C1 | Feishu / SMS channel | ✅ `FeishuChannel`, `SmsChannel` (Twilio) | Shipped in P14 |
| C2 | Harness snapshot tests per adapter | ✅ `harness-channel-format.integration.spec.ts` | Shipped in P14 |
| C3 | Signal live (signal-cli REST) | ✅ `SignalChannel` REST outbound | Shipped in P12 |
| C4 | Google Chat service account | ✅ JWT SA auth + REST (`google-chat-auth.ts`) | Shipped in P14 |
| C5 | Teams / Matrix production hardening | ✅ `fetchWithRetry` backoff | Shipped in P14 |
| C6 | Email IMAP IDLE + thread headers | ✅ real RFC 2177 IDLE (CAPABILITY-gated, poll fallback) + Message-ID/References threading | IDLE protocol upgraded from poll-loop 2026-07-02 |
| C7 | Harness engagement depth vs Slack-only stacks | ✅ `toolSurface: mcp_and_channel` | Shipped in P12 |

---

## 3. slaude-specific

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| SL1 | Slack Agents API status surface | ✅ `anvio_channel__set_status` exported in harness tool defs | Shipped in P12 |
| SL2 | Strict global MCP-only output mode | ✅ harness `toolSurface: mcp_and_channel` | Shipped in P12 |
| SL3 | `/1on1` flow equivalent | ✅ `anvio session 1on1` | Shipped in P12 |
| SL4 | Full CDP browser grant (login flows) | ✅ `ANVIO_BROWSER_CDP_GRANT=1` | Shipped in P14 |
| SL5 | Slack-deep harness (vs multi-channel general) | 🟡 | Optional — multi-channel-general is an intentional Anvio design choice, not a gap |

---

## 4. Runtime & infra

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| R1 | SSH remote agent execution | ✅ `SshRuntimeProvider.execRemote` + CLI | Shipped in P13 |
| R2 | Daytona serverless | ✅ `execRemote` (mock + HTTP) | Shipped in P13 |
| R3 | Modal serverless | ✅ `execRemote` (mock + HTTP) | Shipped in P13 |
| R4 | Singularity/Apptainer | ✅ `SingularityRuntimeProvider` + `anvio runtime exec singularity` | Shipped 2026-07-02 |
| R5 | Claude Code / Codex / Cursor / Antigravity runtime | ✅ OAuth via connection broker + chain fallback | Shipped v1.20.0–v1.21.1 |
| R6 | Desktop app (tray, installer) | 🟡 `apps/desktop/README.md` scaffold only | Real Electron/Tauri build is a separate multi-week project; not attempted here |

---

## 5. Voice

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| V1 | CLI STT/TTS | ✅ | — |
| V2 | Telegram / Discord voice hooks | ✅ | — |
| V3 | Real-time streaming STT | ✅ `ChunkedStreamingSttSession` (P13) + OpenAI Realtime WebSocket (v1.20.0) | — |
| V4 | Discord full VC | 🟡 audio attach only | Deferred — full voice-channel join needs a native Discord voice gateway client |

---

## 6. Observability & research

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| O1 | Trajectory export (Hermes research) | ✅ `anvio session export <id> [--md]` | Shipped in P14 |
| O2 | Atropos RL training live | ✅ MCP preset + direct HTTP fallback + mock (`rl_tool`, `ATROPOS_API_URL`) | Genuinely *live* run still needs a real Tinker-Atropos service — not something this repo can stand up |
| O3 | Langfuse dashboard templates | ✅ [configs/observability/langfuse-dashboard.json](../configs/observability/langfuse-dashboard.json) | Shipped in P14 |
| O4 | Token audit + Prometheus | ✅ P9–P10 | — |

---

## 7. Automation & authoring (minor)

| # | Gap | Anvio (2026-07-02) | Catatan |
|---|-----|----------------------|---------|
| W1 | Hermes workflow→skill pattern docs | ✅ [74-workflow-to-skill-example.md](./74-workflow-to-skill-example.md) | Shipped in P14 |
| W2 | hermes-tech skill import automation | ✅ [hermes-skills-catalog.yml](../.github/workflows/hermes-skills-catalog.yml) — weekly + manual dispatch, opens a PR on catalog changes | Shipped 2026-07-02 |
| W3 | Cron / planner / batch / DAG | ✅ | — |

---

## 8. Keunggulan Anvio (bukan gap)

| # | Capability |
|---|------------|
| 🔵 | Local-first file workspace, no DB required |
| 🔵 | Advanced Agent OS (goals, kanban, batch, credentials) |
| 🔵 | 18+ model providers + routing, chain fallback with auth failover |
| 🔵 | Multi-channel harness (not Slack-only) |
| 🔵 | Dual MD + YAML loader |
| 🔵 | Token usage audit + cost estimate |
| 🔵 | 72 gateway tools + MCP bridge + harness channel tools |
| 🔵 | Unified gateway daemon, SQLite sessions + FTS5 |
| 🔵 | Vendor OAuth runtimes (Claude Code, Cursor, Codex, Antigravity, Nous Portal) with fallback chain |

---

## Yang benar-benar tersisa (P15+ candidates)

Semua item P12/P13/P14 di atas sudah shipped. Sisa gap nyata, diurutkan berdasarkan apa yang *bisa* dikerjakan tanpa akses eksternal:

| Item | Kenapa belum selesai | Bisa dikerjakan tanpa infra tambahan? |
|------|------------------------|----------------------------------------|
| Live MCP E2E dengan kredensial Spotify/Feishu/Yuanbao asli | Butuh akun/API key vendor asli | ❌ — hanya user yang punya akses |
| Atropos RL training run yang benar-benar live | Butuh Tinker-Atropos service asli berjalan | ❌ |
| `computer_use` (macOS CUA) | Butuh macOS + Accessibility API | ❌ — permanent headless-Linux limitation |
| Signal / Google Chat production soak test | Butuh signal-cli server / GCP SA kredensial asli untuk diverifikasi end-to-end | ❌ — kode sudah ada, tinggal verifikasi live |
| Desktop app (tray, installer) | Proyek terpisah (Electron/Tauri + per-OS build pipeline) | 🟡 — bisa discaffold lebih lanjut, tapi bukan "gap kecil" |

~~Honcho gateway tools expose~~ dan ~~hermes-tech skill import automation~~ sudah shipped 2026-07-02 (lihat T1j dan W2 di atas).

---

## Dokumen terkait

| Doc | Isi |
|-----|-----|
| [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md) | **This file** — gap register, updated to reflect actual shipped state |
| [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) | Master gap register (baseline updated alongside this file) |
| [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) | Tool-by-tool mapping |
| [70-phase-p12-priorities.md](./70-phase-p12-priorities.md) | P12 — shipped v1.18.0 |
| [73-phase-p13-priorities.md](./73-phase-p13-priorities.md) | P13 — shipped v1.19.0 |
| [75-phase-p14-priorities.md](./75-phase-p14-priorities.md) | P14 — shipped v1.19.0 |
| [76-unified-gateway.md](./76-unified-gateway.md) | v1.20.0 — unified gateway, SQLite sessions |
| [CHANGELOG.md](../CHANGELOG.md) | v1.20.0–v1.21.1 + Unreleased (Nous/Singularity/Atropos/Yuanbao/video/IMAP-IDLE) |

Terakhir diperbarui: 2026-07-02.
