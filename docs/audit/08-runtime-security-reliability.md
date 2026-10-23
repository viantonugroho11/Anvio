# 08 — Runtime Reliability & Security

> Catatan: bagian keamanan ditulis dengan bahasa eksplisit. Temuan ini berdampak pada deployment yang mengekspos channel atau port ke pihak lain.

## 1. Reliability

| Kontrol                    | Status          | Bukti                                                                                                                                   | Catatan                                              |
| -------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Proteksi infinite loop     | Implemented     | `maxToolIterations` 5 (`agents/src/tool-loop.ts:68`)                                                                                    | Lihat F-LOOP-1                                       |
| Batas iterasi configurable | Partial         | `AgentRuntimeDeps.maxToolIterations` ada, tidak diekspos ke frontmatter/`anvio.yaml`                                                    | —                                                    |
| Token budget               | Missing         | —                                                                                                                                       | —                                                    |
| Spend budget               | Configured Only | `SpendBudgetLedger` tidak di-wire (`platform/src/index.ts:453-458`)                                                                     | —                                                    |
| Execution timeout per turn | Missing         | Tidak ada di runtime lokal                                                                                                              | OpenClaw: 48 jam/attempt + idle 120 s                |
| Timeout HTTP model         | Partial         | Anthropic: default SDK; OpenAI-compatible & Gemini: tanpa timeout (hanya `request.signal`, tidak pernah diisi)                          | Stream yang menggantung = turn menggantung selamanya |
| Timeout tool               | Partial         | per-tool (web_fetch 15 s, executor `timeoutMs`), tidak umum                                                                             | —                                                    |
| Retry & backoff            | Partial         | Failover lintas provider; tidak ada retry ke provider sama; orchestrator punya backoff                                                  | —                                                    |
| Cancellation propagation   | Missing         | Flag set saja (F-LOOP-3); vendor runtime tak bisa di-stop                                                                               | —                                                    |
| Graceful shutdown          | Unverified      | `McpBridge.close()`, `AcpServer.stop()` ada; drain run in-flight tidak terlihat                                                         | —                                                    |
| Session persistence        | Partial         | Akhir turn saja; wipe saat error (P5)                                                                                                   | —                                                    |
| Crash recovery             | Partial         | Approval checkpoint direhidrasi (`harness.rehydrateApprovals`, `platform/src/index.ts:289-291`); run in-flight hilang                   | —                                                    |
| Serialisasi per sesi       | Missing         | Tidak ada mutex di worker; `FilesystemShortTermMemory.appendMessage` read-modify-write (`memory/src/filesystem-memory.ts:31-35`)        | Race last-writer-wins                                |
| Write atomik               | Unverified      | `storage.writeJson` — tidak diperiksa apakah temp+rename                                                                                | —                                                    |
| Degradasi diam-diam        | Risiko          | Tanpa API key → mock untuk semua provider (`platform/src/index.ts:165-173`); YAML tool rusak → default (`tools/src/gateway.ts:206-211`) | Harus log/warn keras                                 |

## 2. Security

### 2.1 Temuan

**S-1 — Kebijakan tool & approval hanya ada di schema (Configured Only).** _(High)_

- `agent.spec.tools` (`core/src/schemas/agent.schema.ts:73`), `agent.spec.approvals.requiredFor` (`:42`, default `['destructive']` di `:77`), `agent.spec.workspace.isolatedWorktree` (`:48`) — tidak ada kode yang membacanya (grep).
- `@anvio/tool-bus` (`packages/tool-bus/src/policy.ts`) mendokumentasikan "runtime ... consults `isToolAllowed` at every tool call", tetapi package ini tidak di-import siapa pun.
- Dampak: penulis agent yang menulis `tools: [file_read]` atau `approvals.requiredFor: [destructive]` mendapat **rasa aman palsu**; semua agent memiliki semua tool yang aktif di gateway global.

**S-2 — Sandbox eksekusi meneruskan seluruh environment proses.** _(High)_

- `process-sandbox.ts:37`: `env: { ...process.env, ...options.env, ANVIO_NETWORK: ... }`. Kode yang ditulis model (`execute_code`, `run_shell`, `terminal`) mewarisi `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANVIO_CREDENTIALS_PASSPHRASE`, token channel, dsb.
- `networkEnabled=false` hanya mengeset variabel `ANVIO_NETWORK=0` untuk runtime non-docker — bukan isolasi jaringan. Hanya runtime `docker` memakai `--network none` (`:135`).
- Mitigasi saat ini: tool-tool tersebut default **off** (`gateway.ts:35-36`, `49-50`, `85-86`).
- Dampak bila diaktifkan: satu prompt injection (mis. dari halaman yang di-`web_fetch`) dapat mengeksfiltrasi semua secret.

**S-3 — SSRF dari tool default.** _(Medium–High tergantung deploy)_ `web_fetch`/`http_request` aktif default tanpa blokir loopback/metadata/RFC1918 (`tools/src/builtins/web-fetch.ts:3-8`).

**S-4 — Endpoint "ACP" tanpa autentikasi dan tanpa validasi kepemilikan sesi.** _(Medium; default bind 127.0.0.1)_ Probe P8. Lihat [05](05-acp-compatibility.md#5-masalah-tambahan-pada-implementasi-saat-ini).

**S-5 — Batas prompt injection lemah pada mode fenced-block.** _(Medium)_ Hasil tool dikirim sebagai pesan **role `user`** (`agents/src/tool-loop.ts:51-56`). Output tool (konten web, file, MCP) tidak dibedakan dari instruksi user. Native mode memakai role `tool` (lebih baik).

**S-6 — Kebocoran identitas lintas user pada delegasi.** _(Medium)_ F-MA-2.

**S-7 — Path confinement berbasis prefix tanpa separator/realpath.** _(Medium)_ `tools/src/builtins/filesystem.ts:5-9`.

**S-8 — API key Gemini di query string.** _(Low–Medium)_ `models/src/providers/gemini.provider.ts:235`; muncul di log proxy, error message yang memuat URL, dan trace HTTP. Gemini mendukung header `x-goog-api-key`.

**S-9 — Injeksi YAML/path di `cronjob create`.** _(Medium bila `cronjob` diaktifkan)_ `platform/src/index.ts:743-760` merakit YAML dengan interpolasi string mentah (`agent`, `schedule`, `timezone`, `slug`) dan menulis ke `automations/${slug}.yaml`. Model dapat menyisipkan kunci YAML atau `../` pada `slug`. Default off.

**S-10 — Kegagalan MCP terlapor sukses.** _(Medium — integritas)_ F-MCP-2.

### 2.2 Kontrol yang sudah baik

- Pemisahan API key vs OAuth runtime dipatuhi (ADR-0009).
- Credential pool terenkripsi, fingerprint salted untuk cache invalidation (`model-router.ts:77-82`, `343-345`).
- MCP first-call approval per sesi, persisten.
- Tool berbahaya (shell, edit, delete, browser, computer_use, mcp_manage, skill_manage) default off.
- Webhook auth (`platform/src/webhook-auth.ts`) — tidak diaudit mendalam.
- Remote binding off by default (ADR-0034).

### 2.3 Tabel kontrol keamanan

| Kontrol                        | Status                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| Tool sandboxing                | Partial (docker benar; process tidak)                                       |
| Command execution restrictions | Partial (default off; tanpa allow-list perintah)                            |
| File system permissions        | Partial (S-7)                                                               |
| Credential isolation           | Missing di sandbox (S-2)                                                    |
| Prompt injection boundaries    | Partial (S-5)                                                               |
| Cross-session data isolation   | Partial (S-4, S-6)                                                          |
| Audit logging                  | Partial (`execution/src/audit-log.ts`, event bus)                           |
| Distributed tracing            | Partial (`withSpan` di worker, `packages/observability`) — tidak divalidasi |
| Metrics                        | Partial (`models/src/metrics-emitter.ts`, `platform/src/usage-stats.ts`)    |

## 3. Risiko deployment produksi (urutan)

1. History hilang saat error provider (P5) — integritas data pengguna.
2. Provider/model salah karena route regex (P3) — kegagalan atau biaya tak terduga.
3. Kebijakan keamanan yang dideklarasikan tetapi tidak ditegakkan (S-1).
4. Secret bocor ke sandbox bila tool eksekusi diaktifkan (S-2).
5. Tanpa lock per sesi: channel grup dengan pesan bersamaan → transkrip korup.
6. Turn menggantung tanpa timeout pada provider fetch-based.
