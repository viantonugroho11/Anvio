# 12 — Validation Results & Scorecard

## 1. Apa yang dieksekusi

Semua eksekusi read-only terhadap repo; tidak ada API berbayar, tidak ada deploy, tidak ada perubahan DB.

| Run                          | Perintah                                                                                                                                                                | Hasil                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Unit test paket yang diaudit | `npx vitest run packages/agents packages/models packages/acp packages/integrations packages/memory packages/tools packages/harness packages/runtimes packages/platform` | **65 file, 402 test — PASS**            |
| Integration test relevan     | `npx vitest run tests/integration/{acp,delegation,routing,integrations}.integration.spec.ts`                                                                            | **4 file, 17 test — PASS**              |
| Audit probes                 | `audit-probe.spec.ts` (di scratchpad sesi, di luar repo; mengimpor source repo via path absolut, menulis hanya ke `os.tmpdir()`)                                        | **8 probe, semua mengonfirmasi defect** |

> Probe "PASS" berarti _asersi tentang perilaku defect terbukti_, bukan bahwa sistem benar. Kode probe direproduksi di §4 agar dapat diangkat menjadi regression test (dengan asersi dibalik) saat perbaikan dikerjakan.

Output probe (dipersingkat):

```text
[P1] {"modelCalls":5,"toolCalls":5,"text":"step1 step2 step3 step4 step5 ","last":"done"}
[P2] {"executed":["anvio_tools__echo","anvio_tools__danger"],"checkpointMessages":["user"]}
[P3] [{"id":"openai","model":"claude-x"}]
[P4] [{"type":"error","error":"Session stopped by user"}]
[P5] [{"role":"user","content":"turn3"}]
[P6] contains recall: false
[P7] "permission denied"
[P8] {"init":{"status":404,...},"prompt":{"status":200,"body":"{\"sessionId\":\"someone-elses-session\",...}"}}
```

## 2. 16 skenario wajib

| #   | Skenario                        | Expected                                                   | Actual                                                                                           | Metode                                                                               | Result                                                                                                       | Evidence / root cause                                               |
| --- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | Single-turn model response      | Teks di-stream, `done` + usage                             | Sesuai                                                                                           | Unit test existing (`agents/src/runtime-stream-failure.spec.ts`, provider scripted)  | **PASS**                                                                                                     | —                                                                   |
| 2   | Multi-turn conversation         | History dipertahankan antar turn, termasuk setelah error   | Jalur sukses: history ditulis ulang di akhir turn. Jalur error: history terhapus                 | Probe P5 + code-read                                                                 | **FAIL** (jalur error)                                                                                       | `runtime.ts:191` overwrite awal turn                                |
| 3   | Single tool call                | Tool dieksekusi, hasil ke model, jawaban final             | Sesuai                                                                                           | Probe P1 (ronde 1–4)                                                                 | **PASS**                                                                                                     | —                                                                   |
| 4   | Sequential dependent tool calls | N ronde, model melihat semua hasil                         | Ronde 1–4 OK; ronde 5 dieksekusi tapi tidak pernah dilihat model, tanpa notice                   | Probe P1                                                                             | **FAIL** (pada batas)                                                                                        | `runtime.ts:201,364-366`                                            |
| 5   | Parallel tool calls             | Paralel atau setidaknya hasil semua tool dipertahankan     | Serial; saat approval di tengah batch, hasil sebelumnya hilang                                   | Probe P2                                                                             | **FAIL**                                                                                                     | `native-tool-loop.ts:14-30`, `runtime.ts:308-320`                   |
| 6   | Failed tool execution           | Error diteruskan, model dapat pulih                        | Built-in: error diformat ke pesan tool (code-read). MCP dengan `isError`: dilaporkan sukses      | Code-read + probe P7                                                                 | Built-in **UNVERIFIED** (tidak dieksekusi end-to-end); MCP **FAIL**                                          | `mcp-stdio-client.ts:20-35`                                         |
| 7   | Model provider failure          | Tanpa konten → error; dengan konten → partial + notice     | Sesuai                                                                                           | Unit test existing (`runtime-stream-failure.spec.ts`)                                | **PASS**                                                                                                     | —                                                                   |
| 8   | Provider fallback               | Failover sebelum chunk pertama, event `failover`           | Sesuai                                                                                           | Unit test existing (`models/src/model-router-stream.spec.ts`), integration `routing` | **PASS**                                                                                                     | Catatan: native-tools tidak mengikuti target baru (G-11, code-read) |
| 9   | Context-window exhaustion       | Kompaksi / pemangkasan berbasis token                      | Tidak ada mekanisme berbasis token; window count-based default off                               | Code-read                                                                            | **UNVERIFIED** (tidak dieksekusi; diperkirakan FAIL dengan error provider)                                   | `agents` tidak membaca `contextWindow`                              |
| 10  | Session recovery                | Resume setelah error/restart                               | Approval resume via gateway: ada. Error turn: history hilang. Run in-flight saat restart: hilang | Probe P5 + code-read                                                                 | **FAIL**                                                                                                     | G-01                                                                |
| 11  | Concurrent sessions             | Sesi berbeda terisolasi; sesi sama terserialisasi          | Sesi berbeda: memory per `sessionId` (code-read). Sesi sama: tanpa lock                          | Code-read                                                                            | **UNVERIFIED**                                                                                               | `gateway-worker.ts` tanpa mutex                                     |
| 12  | ACP initialization              | `initialize` JSON-RPC → capabilities                       | 404                                                                                              | Probe P8                                                                             | **FAIL**                                                                                                     | Bukan Agent Client Protocol                                         |
| 13  | ACP prompt streaming            | `session/update` notifications                             | Tidak ada; hanya SSE kustom                                                                      | Probe P8 + code-read                                                                 | **FAIL**                                                                                                     | `acp-server.ts:80-103`                                              |
| 14  | ACP cancellation                | `session/cancel` → `cancelled`                             | Tidak ada method/endpoint                                                                        | Code-read (+ P8: route tak dikenal = 404)                                            | **FAIL**                                                                                                     | —                                                                   |
| 15  | MCP tool discovery & execution  | `tools/list` + `tools/call` dengan schema & error fidelity | Discovery & call ada (unit + integration `integrations` PASS); schema dibuang; `isError` hilang  | Integration test + code-read + P7                                                    | **PARTIAL** — fungsi dasar PASS, fidelity FAIL; server MCP live tidak dijalankan → **UNVERIFIED** untuk live | `mcp-bridge.ts:23-26`                                               |
| 16  | Multi-agent delegation          | DAG, dependensi, kebijakan kegagalan                       | Sesuai                                                                                           | Integration `delegation.integration.spec.ts` (7 test)                                | **PASS**                                                                                                     | Guardrail delegate tool: code-read (G-18/19)                        |

## 3. Scenario yang tidak dijalankan & rencana reproduksi

| Skenario                                 | Kenapa tidak                        | Cara reproduksi                                                                                                                                                |
| ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider nyata (Anthropic/OpenAI/Gemini) | Butuh API berbayar                  | `ANTHROPIC_API_KEY=... pnpm cli run <agent> "say hi"`; lalu ulangi dengan pesan "implement X" dan `OPENAI_API_KEY` tersedia untuk mereproduksi P3 secara nyata |
| Context exhaustion                       | Butuh provider nyata / prompt besar | Provider scripted yang melempar error 400 "context_length_exceeded" saat `JSON.stringify(messages).length > N`; harapan setelah perbaikan: kompaksi + retry    |
| Concurrent same-session                  | Butuh gateway hidup                 | Publish dua `AGENT_RUN_REQUESTED` untuk sesi sama dengan provider lambat; periksa `memory/sessions/<id>.json`                                                  |
| ACP interop Zed                          | Tidak ada adapter                   | Setelah P1-4: konfigurasi `agent_servers` di Zed ke `anvio acp stdio`                                                                                          |
| MCP live                                 | Butuh server MCP                    | `@modelcontextprotocol/server-everything` via stdio; panggil tool yang mengembalikan `isError`                                                                 |

## 4. Kode probe

Lokasi saat audit: scratchpad sesi (`.../scratchpad/probe/audit-probe.spec.ts`), dijalankan dengan `npx vitest run --root <dir> --globals`. Inti setiap probe:

```ts
// P1: provider selalu mengembalikan 1 tool call → hitung model calls vs tool calls
// P2: satu respons berisi 2 tool call; call ke-2 → pending_approval; periksa checkpoint.messages
// P3: ModelProviderRegistry{anthropic, openai}; agent anthropic/claude-x; pesan "please implement a parser"
// P4: runtime.stop('s1') sebelum run; run → event pertama
// P5: FilesystemMemoryProvider di tmpdir dengan 4 pesan; provider yield error; baca getMessages
// P6: memoryStore.getContext mengembalikan longTerm "teal"; cek JSON request model
// P7: unwrapCallToolResult({content:[{type:'text',text:'permission denied'}], isError:true})
// P8: AcpServer port 0; POST / JSON-RPC initialize; POST /prompt dengan sessionId asing
```

## 5. Scorecard

### Kriteria

- **0** Missing · **1** Minimal/eksperimental · **2** Parsial (ada, gap penting / bug terverifikasi) · **3** Fungsional dengan gap notable · **4** Matang · **5** Robust & tervalidasi.
- Skor turun maksimal ke 2 bila ada bug P0 terverifikasi di kategori tersebut.
- "Unverified" bila bukti tidak cukup; tidak ikut rata-rata. **Tidak ada skor rata-rata keseluruhan** karena ada kategori Unverified.

| Category                  | Score      | Evidence                                                                                                            | Main Gap                                     |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Core architecture         | 3          | Dependency rule dipatuhi; port-based; composition root jelas (`platform/src/index.ts`)                              | Root monolitik; dua sumber kebenaran history |
| Agent brain               | 2          | Model-driven ReAct; tidak ada budget warning/penutup; tidak ada reasoning support                                   | G-03, G-29                                   |
| Agent execution loop      | 2          | Loop nyata (P1), tetapi P1/P2/P4/P5 terverifikasi                                                                   | G-01, G-03, G-04, G-10                       |
| Model integration         | 3          | 3 adapter + 15 provider OpenAI-compatible, normalisasi stream, unit tests                                           | Kapabilitas per model, timeout fetch         |
| Model routing             | 2          | Failover/breaker/pool baik dan teruji; P3 terverifikasi                                                             | G-02, G-11, G-22                             |
| Context management        | 1          | Hanya sliding window count-based, default off; truncation output tool                                               | G-08                                         |
| Persistent memory         | 2          | FTS5/keyword recall, soul facts; P5 & P6 terverifikasi                                                              | G-01, G-14                                   |
| Tool execution            | 2          | 73 built-in, normalisasi hasil; serial, tanpa schema validation/timeout umum, policy tidak ditegakkan               | G-05, G-15, G-16                             |
| MCP integration           | 2          | stdio + Streamable HTTP, first-call gate, dynamic reload; P7                                                        | G-12, G-13                                   |
| ACP compatibility         | 0          | Tidak ada Agent Client Protocol (P8)                                                                                | G-07                                         |
| Multi-agent orchestration | 3          | DAG orchestrator teruji 7 integration test; guardrail delegate lemah                                                | G-18, G-19                                   |
| Reliability               | 2          | Failover & partial-answer baik; tanpa lock, cancel, timeout                                                         | G-09, G-10, G-20                             |
| Security                  | 1          | Default tool berbahaya off & OAuth/API key terpisah; tetapi policy tidak ditegakkan, env leak, SSRF, ACP tanpa auth | G-05, G-06, G-17                             |
| Observability             | Unverified | `withSpan`, metrics emitter, usage stats ada; tidak divalidasi end-to-end                                           | —                                            |
