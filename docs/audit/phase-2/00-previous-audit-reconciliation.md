# 00 — Rekonsiliasi Audit Phase 1

| Item                          | Nilai                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tanggal                       | 2026-10-23                                                                                                                                                                                                                                                                              |
| Baseline Phase 1              | commit `952fda3` ([docs/audit/](../00-executive-summary.md))                                                                                                                                                                                                                            |
| Kode yang diverifikasi        | `main` @ `a7e3a06` (v2.10.0)                                                                                                                                                                                                                                                            |
| Perubahan kode sejak baseline | Hanya `d1f760a` (P0-1/P0-2, PR [#111](https://github.com/viantonugroho11/Anvio/pull/111)) dan `ef468aa` (update SDK, PR [#109](https://github.com/viantonugroho11/Anvio/pull/109)). Setelah merge, hanya `CHANGELOG.md` dan `README.md` yang berubah (`git diff --stat 02a9ed8..main`). |
| Dokumen remediasi lain        | Tidak ada issue tracker/remediation doc baru selain CHANGELOG `[2.10.0]`.                                                                                                                                                                                                               |

## 1. Metode verifikasi

1. **Re-run probe Phase 1** (P1–P8) terhadap `main`. Probe yang dulu "PASS" berarti defect terbukti; sekarang probe yang **gagal** berarti defect sudah hilang.
2. **Diff kode** sejak `952fda3` untuk setiap file yang dirujuk temuan.
3. **Re-grep** temuan berbasis grep. Satu grep Phase 1 ternyata cacat (lihat §4).

Output re-run probe di `main`:

```text
[P1] {"modelCalls":5,"toolCalls":5,"text":"step1 ... step5 ","last":"done"}          → defect masih ada
[P2] {"executed":["echo","danger"],"checkpointMessages":["user"]}                       → defect masih ada
[P3] [{"id":"anthropic","model":"claude-x"}]                                           → FIXED (dulu "openai")
[P4] [{"type":"error","error":"Session stopped by user"}]                               → defect masih ada
[P5] [turn1,a1,turn2,a2,turn3]                                                         → FIXED (dulu hanya [turn3])
[P6] contains recall: false                                                            → defect masih ada
[P7] "permission denied"                                                               → defect masih ada
[P8] init 404, /prompt 200 untuk sessionId asing                                      → defect masih ada
Tests: 2 failed (P3, P5 — asersi defect tidak lagi terpenuhi) | 6 passed
```

## 2. Matriks status semua temuan Phase 1

ID dipertahankan dari [09-gap-analysis.md](../09-gap-analysis.md). Alias F-/S- dari dokumen 02–08 dicantumkan.

| ID   | Alias     | Kategori                | Severity awal | Status                    | Bukti                                                                                                                                                                      |
| ---- | --------- | ----------------------- | ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-01 | F-LOOP-4  | Loop/state              | Critical      | **FIXED**                 | Probe P5 di `main`; regression test `packages/agents/src/runtime-history-and-routing.spec.ts` (3 test) gagal di kode lama, lulus di `d1f760a`                              |
| G-02 | F-MODEL-1 | Model routing           | Critical      | **FIXED**                 | Probe P3; 3 test di spec yang sama + test schema `model.routing`                                                                                                           |
| G-03 | F-LOOP-1  | Loop                    | High          | NOT FIXED                 | Probe P1; `runtime.ts` iterasi masih `DEFAULT_MAX_TOOL_ITERATIONS = 5`                                                                                                     |
| G-04 | F-LOOP-2  | Approval                | High          | NOT FIXED                 | Probe P2                                                                                                                                                                   |
| G-05 | S-1       | Security                | High          | **NOT FIXED (dikoreksi)** | `agent.spec.tools`, `approvals.requiredFor`, `@anvio/tool-bus`: masih 0 konsumen. Koreksi: `isolatedWorktree` **dibaca** di `platform/src/gateway-worker.ts:177`, lihat §4 |
| G-06 | S-2       | Security                | High          | NOT FIXED                 | `execution/src/sandbox/process-sandbox.ts:37` tidak berubah                                                                                                                |
| G-07 | —         | ACP                     | High          | NOT FIXED                 | Probe P8                                                                                                                                                                   |
| G-08 | —         | Context                 | High          | NOT FIXED                 | Tidak ada perubahan di `packages/agents` selain G-01/02                                                                                                                    |
| G-09 | —         | Reliability             | High          | NOT FIXED                 | `gateway-worker.ts` tanpa lock; diperparah oleh temuan P2-CH-01 (bus in-process serial)                                                                                    |
| G-10 | F-LOOP-3  | Reliability             | High          | NOT FIXED                 | Probe P4                                                                                                                                                                   |
| G-11 | F-MODEL-3 | Model                   | Medium        | NOT FIXED                 | `runtime.ts` native-tools masih dihitung sebelum router                                                                                                                    |
| G-12 | F-MCP-1   | MCP                     | Medium        | NOT FIXED                 | `mcp-bridge.ts:23-26`                                                                                                                                                      |
| G-13 | F-MCP-2   | MCP                     | Medium        | NOT FIXED                 | Probe P7                                                                                                                                                                   |
| G-14 | —         | Memory                  | Medium        | NOT FIXED                 | Probe P6                                                                                                                                                                   |
| G-15 | —         | Tools                   | Medium        | NOT FIXED                 | Probe P2 (serial)                                                                                                                                                          |
| G-16 | —         | Tools                   | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-17 | S-3       | Security                | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-18 | F-MA-1/2  | Multi-agent             | Medium        | NOT FIXED                 | `platform/src/index.ts` `delegateTask` unchanged                                                                                                                           |
| G-19 | F-MA-3    | Multi-agent             | Medium        | NOT FIXED                 | `orchestrator.ts` unchanged                                                                                                                                                |
| G-20 | —         | Model                   | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-21 | —         | Model                   | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-22 | F-MODEL-2 | Model                   | Medium        | NOT FIXED                 | Tambahan: `model.override` juga di-strip schema (ditemukan saat P0-2), jadi jalur `chat()` pun tidak pernah menerimanya                                                    |
| G-23 | S-5       | Security                | Medium        | NOT FIXED                 | `tool-loop.ts:51-56`                                                                                                                                                       |
| G-24 | —         | Reliability             | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-25 | —         | Arsitektur              | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-26 | F-MCP-3   | MCP                     | Low–Med       | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-27 | S-7       | Security                | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-28 | S-8       | Security                | Low           | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-29 | —         | Reasoning               | Low–Med       | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-30 | —         | Budget                  | Low           | NOT FIXED                 | code unchanged                                                                                                                                                             |
| G-31 | —         | Arsitektur              | Low           | NOT FIXED                 | `platform/src/index.ts` kini 1188 baris (sama)                                                                                                                             |
| G-32 | —         | Multi-agent             | Low           | NOT FIXED                 | code unchanged                                                                                                                                                             |
| S-4  | —         | Security (ACP auth)     | Medium        | NOT FIXED                 | Probe P8                                                                                                                                                                   |
| S-9  | —         | Security (cronjob YAML) | Medium        | NOT FIXED                 | code unchanged                                                                                                                                                             |

Ringkas: **2 FIXED, 31 NOT FIXED, 0 REGRESSION, 0 OBSOLETE.** Tidak ada temuan yang berstatus PARTIALLY FIXED karena perbaikan G-01/G-02 memenuhi semua acceptance criteria di [roadmap Phase 1](../11-implementation-roadmap.md) (P0-1, P0-2) — kecuali sub-butir "samakan `override` di `ModelRouter.stream`" yang dari awal dicatat di luar cakupan dan sekarang dilacak sebagai G-22.

Tidak ada REGRESSION: suite penuh `vitest run packages` (616 test) dan `tests/integration` (157 test) lulus setelah `d1f760a`; suite area Phase 2 (souls, soul-gate, learning, skills, channels, automation, goals, kanban, events, harness) — **30 file / 148 test PASS** pada audit ini.

## 3. Rincian pekerjaan tersisa

Untuk ringkas, item dengan rincian identik dengan roadmap Phase 1 tidak diulang; rujukan menunjuk ke [11-implementation-roadmap.md](../11-implementation-roadmap.md). Semua item ini masuk backlog terpadu di [07-remaining-gap-breakdown.md](07-remaining-gap-breakdown.md).

| ID                 | Sudah diimplementasi                                              | Belum                                                                                                   | Root cause                                                                                       | Missing impl. vs missing verification | Rujukan     |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------- |
| G-03               | —                                                                 | Budget configurable, warning, final summarization call                                                  | Loop berakhir oleh kondisi `for` tanpa langkah penutup                                           | Missing implementation                | P0-3        |
| G-04               | —                                                                 | Checkpoint lengkap + eksekusi langsung tool yang disetujui                                              | Checkpoint dibangun dari `messages` sebelum push hasil tool                                      | Missing implementation                | P0-4        |
| G-05               | `isolatedWorktree` membuat worktree (`gateway-worker.ts:177-191`) | Allow-list `tools`, enforcement `approvals`, policy tool-bus; konsumsi `worktreePath` oleh runtime/tool | Tidak ada decorator policy di rantai `RuntimeToolPort`; `worktreePath` hanya ditulis ke metadata | Missing implementation                | P0-5        |
| G-06               | —                                                                 | Env allow-list sandbox                                                                                  | `...process.env`                                                                                 | Missing implementation                | P0-5        |
| G-07               | —                                                                 | Adapter ACP stdio                                                                                       | Package `acp` adalah API HTTP kustom                                                             | Missing implementation                | P1-4        |
| G-08/G-14          | —                                                                 | Context builder token-based + injeksi recall                                                            | `agents` hanya membaca `shortTerm`                                                               | Missing implementation                | P1-3        |
| G-09               | —                                                                 | Serialisasi per sesi                                                                                    | Tidak ada mutex; kini juga lihat P2-CH-01                                                        | Missing implementation                | P1-2        |
| G-10               | —                                                                 | AbortController per run                                                                                 | `stop()` hanya set flag                                                                          | Missing implementation                | P1-1        |
| G-12/G-13          | —                                                                 | Schema passthrough + `isError`                                                                          | Descriptor dua field; unwrap teks                                                                | Missing implementation                | P1-5        |
| G-11               | —                                                                 | Native-tools mengikuti provider akhir                                                                   | Keputusan sebelum router                                                                         | Missing implementation                | P1-6        |
| G-18/G-19          | —                                                                 | Guard delegasi                                                                                          | Konteks tool tanpa depth/parent/user                                                             | Missing implementation                | P1-7        |
| G-22               | `routing` kini di schema                                          | `override` di schema + `ModelRouter.stream`                                                             | Field di-strip zod; `stream` tidak membaca override                                              | Missing implementation                | baru: T-022 |
| G-15..G-32 sisanya | —                                                                 | Lihat roadmap P2/P3                                                                                     | —                                                                                                | Missing implementation                | P2-x, P3-x  |

## 4. Koreksi terhadap laporan Phase 1

**S-1 / G-05, bagian `isolatedWorktree`.** Phase 1 menyatakan `agent.spec.workspace.isolatedWorktree` tidak dibaca kode mana pun. Grep yang dipakai memfilter `grep -v '\.spec\.'` untuk membuang file test, tetapi filter itu juga membuang baris yang mengandung `agent.spec.` — termasuk `platform/src/gateway-worker.ts:177`:

```ts
if (agent.spec.workspace?.isolatedWorktree && workspace.worktrees) {
  const wt = await workspace.worktrees.create(sessionId);
  await workspace.sessions.update(sessionId, { metadata: { ...stored.metadata, worktreePath: wt.path, ... } });
```

Status yang benar: **Partial** — worktree dibuat (hanya di jalur gateway, bukan CLI/ACP), tetapi `worktreePath` tidak dibaca oleh runtime atau tool mana pun (grep `worktreePath` → hanya penulisan di `:183`), sehingga tool tetap bekerja di workspace host. Selain itu, update `done` di `gateway-worker.ts:286-300` menulis `metadata: { ...stored.metadata, ... }` dari snapshot lama, sehingga `worktreePath` tertimpa hilang setelah turn pertama.

Grep ulang tanpa filter cacat mengonfirmasi bahwa `agent.spec.tools`, `approvals.requiredFor`, dan `@anvio/tool-bus` memang tidak memiliki konsumen — bagian lain S-1 tetap benar.

Pelajaran metodologi untuk audit selanjutnya: pakai `grep -v '\.spec\.ts:'` (nama file) bukan `'\.spec\.'` (substring).
