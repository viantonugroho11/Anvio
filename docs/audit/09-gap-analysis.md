# 09 — Gap Analysis

Jenis gap: **FA** = fundamental architectural limitation, **MI** = missing implementation, **II** = incomplete integration (kode ada, tidak tersambung), **DT** = intentional design tradeoff, **BUG** = implementasi salah.

Severity: Critical / High / Medium / Low. ID merujuk temuan di dokumen 02–08.

## 1. Register gap

| ID   | Dimensi         | Gap                                                                                                                      | Jenis       | Severity                                 | Bukti                                                                    | Verifikasi      |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| G-01 | Loop / state    | Turn gagal menimpa short-term memory dengan 1 pesan (F-LOOP-4)                                                           | BUG         | **Critical**                             | `agents/src/runtime.ts:191`, `memory/src/provider-factory.ts:98-103`     | Probe P5        |
| G-02 | Model routing   | Route preference regex menimpa provider agent, mengirim model id ke provider lain (F-MODEL-1)                            | BUG         | **Critical**                             | `runtime.ts:165-166`, `model-provider-registry.ts:7-13`                  | Probe P3        |
| G-03 | Loop            | Ronde tool terakhir tak diobservasi model; budget habis tanpa notice; transkrip tersimpan ≠ yang dilihat user (F-LOOP-1) | BUG         | **High**                                 | `runtime.ts:201`, `364-372`                                              | Probe P1        |
| G-04 | Loop / approval | Checkpoint approval membuang hasil tool yang sudah jalan → eksekusi ganda (F-LOOP-2)                                     | BUG         | **High**                                 | `runtime.ts:308-320`, `native-tool-loop.ts:20-30`                        | Probe P2        |
| G-05 | Security        | `agent.spec.tools`, `approvals`, `isolatedWorktree`, `@anvio/tool-bus` tidak ditegakkan (S-1)                            | II          | **High**                                 | `agent.schema.ts:42-48,73`, `tool-bus/src/policy.ts`                     | grep 0 konsumen |
| G-06 | Security        | Sandbox process mewarisi seluruh `process.env` (S-2)                                                                     | BUG         | **High** (bila tool exec on)             | `execution/src/sandbox/process-sandbox.ts:37`                            | code-read       |
| G-07 | ACP             | "ACP" bukan Agent Client Protocol                                                                                        | MI          | **High** (Critical bila ACP requirement) | `packages/acp/*`                                                         | Probe P8        |
| G-08 | Context         | Tidak ada manajemen context berbasis token / overflow recovery                                                           | MI          | **High**                                 | `agents` tidak membaca `contextWindow`                                   | code-read       |
| G-09 | Reliability     | Tidak ada serialisasi per sesi                                                                                           | MI          | **High**                                 | `platform/src/gateway-worker.ts`                                         | code-read       |
| G-10 | Reliability     | Cancel tidak membatalkan HTTP/tool; stop flag basi; vendor runtime tak bisa di-stop (F-LOOP-3)                           | BUG+MI      | **High**                                 | `runtime.ts:95-97,221-228`; `runtime-routing-agent-runtime.ts:24-26`     | Probe P4        |
| G-11 | Model           | Native-tools ditentukan sebelum failover (F-MODEL-3)                                                                     | BUG         | Medium                                   | `runtime.ts:167-170`                                                     | code-read       |
| G-12 | MCP             | `inputSchema` dibuang (F-MCP-1)                                                                                          | BUG         | Medium                                   | `mcp-bridge.ts:23-26`, `mcp-tool-port.ts:159-167`                        | code-read       |
| G-13 | MCP             | `isError` hilang (F-MCP-2)                                                                                               | BUG         | Medium                                   | `mcp-stdio-client.ts:20-35`                                              | Probe P7        |
| G-14 | Memory          | Recall long-term dihitung lalu dibuang                                                                                   | II          | Medium                                   | `runtime.ts:190`, `provider-factory.ts:74-94`                            | Probe P6        |
| G-15 | Tools           | Eksekusi tool serial                                                                                                     | MI          | Medium                                   | `native-tool-loop.ts:14`                                                 | Probe P2        |
| G-16 | Tools           | Tanpa validasi argumen terhadap schema & tanpa timeout umum                                                              | MI          | Medium                                   | `builtins/index.ts:152-178`, `gateway.ts:268-277`                        | code-read       |
| G-17 | Security        | SSRF default (`web_fetch`, `http_request`)                                                                               | MI          | Medium                                   | `web-fetch.ts:3-8`                                                       | code-read       |
| G-18 | Multi-agent     | `delegate_task`: tanpa depth limit, userId default, tanpa parent (F-MA-1/2)                                              | BUG         | Medium                                   | `platform/src/index.ts:715-729`                                          | code-read       |
| G-19 | Multi-agent     | `awaiting_approval` subagent = completed (F-MA-3)                                                                        | BUG         | Medium                                   | `orchestrator.ts:127-138`                                                | code-read       |
| G-20 | Model           | Timeout HTTP tidak ada pada adapter fetch                                                                                | MI          | Medium                                   | `openai-compatible.provider.ts` `post()`, `gemini.provider.ts:237-241`   | code-read       |
| G-21 | Model           | Tidak ada registry kapabilitas per model (reasoning, vision, structured output, context window)                          | FA (ringan) | Medium                                   | `ChatRequest` di core                                                    | code-read       |
| G-22 | Model           | `ModelRouter.stream` mengabaikan `model.override` yang dihormati `chat` (F-MODEL-2)                                      | BUG         | Medium                                   | `model-router.ts:99-119` vs `187-245`                                    | code-read       |
| G-23 | Security        | Hasil tool sebagai role `user` di mode fenced (S-5)                                                                      | DT/BUG      | Medium                                   | `tool-loop.ts:51-56`                                                     | code-read       |
| G-24 | Reliability     | Degradasi diam (mock provider, YAML default)                                                                             | DT          | Medium                                   | `platform/src/index.ts:165-173`, `gateway.ts:206-211`                    | code-read       |
| G-25 | Arsitektur      | Dua sumber kebenaran history (memory vs session store)                                                                   | FA          | Medium                                   | [01 §5](01-current-architecture.md#5-dua-sumber-kebenaran-untuk-history) | code-read       |
| G-26 | MCP             | Stub transport memalsukan sukses (F-MCP-3)                                                                               | DT          | Low–Medium                               | `mcp-bridge.ts:80-93`                                                    | code-read       |
| G-27 | Security        | Path prefix check (S-7)                                                                                                  | BUG         | Medium                                   | `filesystem.ts:5-9`                                                      | code-read       |
| G-28 | Security        | Gemini key di URL (S-8)                                                                                                  | BUG         | Low                                      | `gemini.provider.ts:235`                                                 | code-read       |
| G-29 | Reasoning       | Tidak ada dukungan thinking/reasoning model                                                                              | MI          | Low–Medium                               | grep 0 hit                                                               | code-read       |
| G-30 | Budget          | `SpendBudgetLedger` tidak di-wire                                                                                        | II          | Low                                      | `platform/src/index.ts:453-458`                                          | code-read       |
| G-31 | Arsitektur      | Composition root 1188 baris + `slash-commands-extras.ts` 1419 baris                                                      | DT          | Low                                      | ukuran file                                                              | —               |
| G-32 | Multi-agent     | Paralel tanpa batas konkurensi                                                                                           | MI          | Low                                      | `orchestrator.ts:231-236`                                                | code-read       |

## 2. Peta per dimensi (14)

| #   | Dimensi            | Gap utama                                           | Severity tertinggi |
| --- | ------------------ | --------------------------------------------------- | ------------------ |
| 1   | Agent brain        | Budget kecil tanpa penutup, tanpa reasoning support | High               |
| 2   | Execution loop     | G-01, G-03, G-04, G-10                              | Critical           |
| 3   | Model abstraction  | G-21, G-11                                          | Medium             |
| 4   | Context management | G-08                                                | High               |
| 5   | Memory             | G-01, G-14, G-25                                    | Critical           |
| 6   | Tool execution     | G-15, G-16                                          | Medium             |
| 7   | MCP                | G-12, G-13                                          | Medium             |
| 8   | ACP                | G-07                                                | High               |
| 9   | Multi-agent        | G-18, G-19                                          | Medium             |
| 10  | Runtime lifecycle  | G-09, G-10                                          | High               |
| 11  | Reliability        | G-09, G-20, G-24                                    | High               |
| 12  | Security           | G-05, G-06                                          | High               |
| 13  | Observability      | Tidak divalidasi                                    | —                  |
| 14  | Extensibility      | Tidak ada gap signifikan                            | Low                |

## 3. Yang **bukan** gap (sengaja tidak direkomendasikan)

- Planner eksplisit / tree-of-thought: Hermes & OpenClaw juga model-driven. **DT**, tidak perlu.
- SQLite/Postgres wajib: melanggar prinsip Level 1. Perbaiki semantik write di filesystem dulu.
- Paritas 500 iterasi Hermes: cukup configurable + warning.
- UI orkestrasi worktree ala Orca: di luar lingkup runtime.
