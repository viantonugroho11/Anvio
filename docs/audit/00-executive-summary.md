# 00 — Executive Summary: Audit Agent Core, Brain, ACP & Model Integration

| Item                | Nilai                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tanggal audit       | 2026-10-23                                                                                                                                                                                                                                                             |
| Commit yang diaudit | `952fda3255756c92bc56aa59546164c6e09d3efc` (branch `chore/update-sdks-bundle-codex`)                                                                                                                                                                                   |
| Sifat audit         | Read-only. Tidak ada perubahan kode produksi. Probe test dijalankan dari scratchpad di luar repo.                                                                                                                                                                      |
| Referensi           | Hermes Agent `NousResearch/hermes-agent@bf0203a794a0`, OpenClaw `openclaw/openclaw@c2ee4ec64560`, Orca `stablyai/orca@2f2a0bca5e3c`, ACP spec `agentclientprotocol/agent-client-protocol@bd8f1af8e8b7` (protocolVersion `1`, SDK npm `@agentclientprotocol/sdk@2.0.1`) |

Dokumen lain dalam folder ini:
[01 arsitektur](01-current-architecture.md) · [02 agent brain](02-agent-brain-and-loop.md) · [03 perbandingan](03-framework-comparison.md) · [04 model](04-model-integration.md) · [05 ACP](05-acp-compatibility.md) · [06 MCP & tools](06-mcp-and-tools.md) · [07 multi-agent](07-multi-agent-orchestration.md) · [08 security/reliability](08-runtime-security-reliability.md) · [09 gap](09-gap-analysis.md) · [10 target arsitektur](10-recommended-architecture.md) · [11 roadmap](11-implementation-roadmap.md) · [12 validasi](12-validation-results.md)

---

## Kesimpulan utama (TL;DR)

1. **Anvio adalah platform agent local-first yang luas (channel, skills, souls, goals, automation), tetapi "otak" agent-nya tipis.** Inti loop ada di satu fungsi (`packages/agents/src/runtime.ts:114-381`, ±270 baris). Ia _memang_ loop iteratif tool-calling yang nyata — bukan sekadar wrapper satu-panggilan — tetapi dengan budget 5 iterasi, eksekusi tool serial, tanpa manajemen context berbasis token, dan beberapa bug korektness yang terverifikasi.
2. **"ACP" di Anvio bukan Agent Client Protocol.** `packages/acp` adalah HTTP + SSE kustom (`POST /prompt`, `POST /prompt/stream`, `GET /health`) dengan label `anvio-acp/v1`. Spec ACP resmi adalah JSON-RPC 2.0 newline-delimited di atas stdio (`initialize`, `session/new`, `session/prompt`, `session/update`, `session/cancel`, `session/request_permission`). **Klasifikasi: Not Compatible — Adapter Required.** Terverifikasi oleh probe P8.
3. **Integrasi model cukup matang di layer provider** (Anthropic SDK, Gemini REST, 15+ provider OpenAI-compatible, circuit breaker, failover sebelum chunk pertama, credential pool), **tetapi pemilihan provider di runtime punya bug P0**: preferensi route berbasis regex pesan _mengalahkan_ provider yang dikonfigurasi agent dan mengirim model id agent ke provider lain (probe P3).
4. **Delapan temuan terverifikasi lewat probe eksekusi** (lihat [12](12-validation-results.md)); tiga di antaranya P0: history sesi terhapus saat turn gagal (P5), routing provider menimpa konfigurasi agent (P3), dan hasil tool di iterasi terakhir tidak pernah dilihat model tanpa notifikasi budget habis (P1).
5. **Banyak kontrol keamanan hanya ada di schema (Configured Only):** `agent.spec.tools`, `agent.spec.approvals.requiredFor`, `agent.spec.workspace.isolatedWorktree`, dan seluruh package `@anvio/tool-bus` tidak dipakai di jalur eksekusi mana pun.

---

## Jawaban eksplisit 10 pertanyaan

### 1. Arsitektur apa yang sebenarnya diimplementasikan?

Monorepo TypeScript dengan **composition root tunggal** (`packages/platform/src/index.ts`, 1188 baris) yang merakit: workspace loader (Markdown/YAML), memory provider berbasis filesystem, tool gateway built-in, wrapper MCP, harness approval/channel, model registry + router, `DefaultAgentRuntime` (loop lokal), dan `RuntimeRoutingAgentRuntime` yang bisa mendelegasikan seluruh turn ke runtime vendor (Claude Code SDK, Codex, Cursor, Antigravity, SSH, dst.). Pola keseluruhan: **gateway + event bus + worker**, mirip OpenClaw dalam bentuk, namun loop agent-nya jauh lebih sederhana. Detail: [01](01-current-architecture.md).

### 2. Bagaimana agent brain bekerja?

Per turn: rakit system prompt (persona + skill + soul) → pilih provider (route preference → agent) → loop maks 5 iterasi: stream model → kumpulkan tool call (native `tool_use` atau blok fenced `anvio_tool`) → eksekusi **serial** via `RuntimeToolPort` → tambahkan hasil sebagai pesan → ulangi. Berhenti bila tidak ada tool call, budget habis, error, stop, atau approval diperlukan. Tidak ada planner eksplisit, tidak ada refleksi, tidak ada kompaksi berbasis token. Planning sepenuhnya diserahkan ke model. Detail: [02](02-agent-brain-and-loop.md).

### 3. Apakah loop-nya sebanding dengan Hermes Agent?

**Tidak.** Secara bentuk sama (ReAct-style: model → tool → observasi → model), tetapi Hermes: budget default 500 iterasi dengan warning ke model, eksekusi tool paralel (ThreadPoolExecutor, urutan hasil dipertahankan), kompresi context pada 50% context window dengan head/tail protection dan pruning tool output, interrupt yang membatalkan API call in-flight, fallback provider untuk 429/5xx/401. Anvio: 5 iterasi tanpa warning, serial, sliding window berbasis _jumlah pesan_ (default mati), stop hanya dicek di antara chunk dan tidak membatalkan HTTP/tool. Detail: [03](03-framework-comparison.md).

### 4. Kapabilitas OpenClaw mana yang diimplementasikan?

Ada: gateway daemon terpadu (`anvio gateway start`), multi-channel (14 adapter), event stream (progress/chunk/approval), approval flow lintas channel, runtime vendor sebagai backend, skill/plugin catalog, failover model. Tidak ada/parsial: serialisasi run per-sesi (OpenClaw punya session controller + `activeWriterRunId`), validasi argumen tool terhadap schema sebelum dispatch, timeout per-attempt & idle timeout model, kompaksi otomatis dengan retry, hook `before_tool_call` yang bisa memblokir. Detail: [03](03-framework-comparison.md).

### 5. Pola Orca mana yang relevan?

Orca **bukan agent runtime**; ia IDE/orchestrator desktop (Electron) yang menjalankan agent CLI (Claude Code, Codex, OpenCode, Pi) secara paralel di git worktree terpisah. Yang relevan bagi Anvio hanya: isolasi per-worktree untuk runtime vendor (Anvio punya schema `isolatedWorktree` tapi tidak ditegakkan) dan pola "agent CLI sebagai unit eksekusi". Perbandingan agent-brain dengan Orca **Not Applicable**.

### 6. Apakah ACP benar-benar kompatibel?

**Tidak.** Protocol compatibility: tidak ada (bukan JSON-RPC, bukan stdio, tidak ada `initialize`/`session/*`). Functional interoperability dengan Zed/JetBrains/VS Code ACP client: nol — client ACP mana pun akan gagal di handshake. Production readiness: endpoint HTTP tanpa autentikasi yang menerima `sessionId` arbitrer. Integration test `tests/integration/acp.integration.spec.ts` lulus, tetapi hanya menguji API kustom tersebut. Detail: [05](05-acp-compatibility.md).

### 7. Bagaimana model LLM diintegrasikan?

Melalui port `ModelProvider` (`chat`, `stream`, `supportsNativeTools`) dari `@anvio/core`, dengan tiga adapter: Anthropic (SDK resmi), Gemini (REST + SSE), dan OpenAI-compatible (fetch generik untuk OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Together, xAI, Fireworks, Moonshot, Cerebras, SambaNova, Perplexity, Cohere, HuggingFace, Ollama, custom). Stream dinormalisasi ke `StreamChunk` (`text_delta`, `tool_use`, `done`, `error`, `failover`). `ModelRouter` membungkus dengan fallback chain dari `providers/routing.yaml`, circuit breaker, budget USD, dan credential pool. Detail: [04](04-model-integration.md).

### 8. Bisakah provider/model diganti tanpa mengubah agent core?

**Sebagian besar ya** untuk provider OpenAI-compatible (cukup env var / `baseUrl` di frontmatter). Namun ada kopling: (a) keputusan native-tools dibuat dari provider awal, bukan provider yang akhirnya dipakai setelah failover; (b) `resolveForRoute` menimpa provider agent; (c) tidak ada registry kapabilitas per-model (reasoning, vision, structured output, context window tidak dipakai runtime); (d) parameter khusus provider (thinking, reasoning effort, `parallel_tool_calls`, `response_format`) tidak dapat diteruskan.

### 9. Gap arsitektur terpenting?

1. Korektness loop & state (P0): wipe history saat error, budget iterasi terakhir hilang, approval checkpoint membuang hasil tool, stop flag basi.
2. Routing provider menimpa konfigurasi agent (P0).
3. Kontrol keamanan tool yang hanya ada di schema; sandbox yang meneruskan seluruh `process.env` (termasuk API key) ke kode yang dijalankan model; `web_fetch`/`http_request` aktif default tanpa guard SSRF.
4. ACP tidak sesuai spec.
5. Context management tidak berbasis token; long-term recall dihitung lalu dibuang.
6. MCP: `inputSchema` dibuang, `isError` hilang, stub transport memalsukan sukses.
   Detail & severity: [09](09-gap-analysis.md).

### 10. Apa yang harus diperbaiki pertama?

Urutan P0 (lihat [11](11-implementation-roadmap.md)):

1. Hentikan wipe short-term memory di awal turn (`runtime.ts:191`).
2. Hormati provider agent; jadikan route preference opt-in (`runtime.ts:165-166`).
3. Setelah budget habis, lakukan satu panggilan final tanpa tools + notice eksplisit; jadikan budget configurable.
4. Simpan hasil tool yang sudah selesai ke checkpoint approval.
5. Tegakkan `agent.spec.tools` + approvals di satu titik (`RuntimeToolPort` wrapper) dan scrub env di sandbox.
   Lalu P1: ACP adapter stdio sesuai spec, MCP schema passthrough & `isError`, context budget berbasis token.

---

## Scorecard ringkas

Skor 0–5 (definisi di [12](12-validation-results.md#5-scorecard)). Tidak ada rata-rata keseluruhan karena ada kategori Unverified.

| Kategori                  | Skor       | Main gap                                                                   |
| ------------------------- | ---------- | -------------------------------------------------------------------------- |
| Core architecture         | 3          | Composition root monolitik 1188 baris; dua sumber kebenaran history        |
| Agent brain               | 2          | Planning implisit, tidak ada evaluasi/refleksi, budget kecil               |
| Agent execution loop      | 2          | Bug P0 terverifikasi (P1, P2, P4, P5)                                      |
| Model integration         | 3          | Adapter baik; kapabilitas tidak diregistrasi; tidak ada reasoning/thinking |
| Model routing             | 2          | Route preference menimpa agent (P3); inkonsistensi `chat` vs `stream`      |
| Context management        | 1          | Hanya sliding window jumlah pesan (default off)                            |
| Persistent memory         | 2          | Recall dihitung tapi tidak diinjeksi (P6); wipe saat error (P5)            |
| Tool execution            | 2          | Serial, tanpa timeout per tool, tanpa validasi schema                      |
| MCP integration           | 2          | Schema dibuang, `isError` hilang (P7)                                      |
| ACP compatibility         | 0          | Bukan Agent Client Protocol (P8)                                           |
| Multi-agent orchestration | 3          | Orchestrator DAG teruji; delegate tool tanpa depth limit/parent            |
| Reliability               | 2          | Tidak ada lock per-sesi, cancel tidak membatalkan I/O                      |
| Security                  | 1          | Policy tidak ditegakkan, env leak ke sandbox, ACP tanpa auth, SSRF         |
| Observability             | Unverified | Span & metrics ada; tidak divalidasi end-to-end                            |

## Pertanyaan terbuka untuk pemilik proyek

1. Apakah "ACP" di roadmap dimaksudkan sebagai **Agent Client Protocol (Zed)** atau API editor internal? Rekomendasi di [05](05-acp-compatibility.md) mengasumsikan yang pertama; jika yang kedua, sebaiknya package di-rename untuk menghindari klaim kompatibilitas palsu.
2. Apakah runtime `local` dimaksudkan sebagai agent otonom jangka panjang (seperti Hermes) atau "chat + beberapa tool"? Budget 5 iterasi menyiratkan yang kedua; dokumentasi (`docs/24`, `docs/50`) menyiratkan yang pertama.
3. Apakah Level 1 (filesystem) harus aman untuk multi-user di channel publik (Slack/Telegram grup)? Jawabannya menentukan prioritas isolasi sesi & lock.
