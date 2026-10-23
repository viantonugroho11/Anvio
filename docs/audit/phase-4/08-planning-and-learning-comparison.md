# 08 — Planning & Learning Comparison

| Kapabilitas                | Anvio                                       | Slaude                                                                                                                                                                | Sumber kapabilitas Slaude |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Dekomposisi tujuan         | Model-driven + tool `todo`                  | Model-driven (TodoWrite CLI)                                                                                                                                          | SDK                       |
| Perencanaan task           | Orchestrator DAG, Plan-Execute-Review (CLI) | Tidak ada planner sendiri                                                                                                                                             | —                         |
| Eksekusi multi-langkah     | ≤5 iterasi (G-03)                           | Loop CLI tanpa batas eksplisit dari Slaude                                                                                                                            | SDK                       |
| Kelanjutan task            | Approval resume (gateway)                   | Sesi hidup + resume transkrip + redelivery antrean                                                                                                                    | Slaude + SDK              |
| Tugas terjadwal            | Cron in-process tanpa timezone (P2-PLAN-01) | Cron Slack dengan **klaim CAS** `next_run_at` sebelum dispatch, failover leader (`gateway/slack/cron-scheduler.ts`, `db/cron-jobs.ts`; `tests/cron-failover.test.ts`) | Slaude                    |
| Refleksi                   | ✗                                           | Prompt auto-evolve pasca-turn (sebagian refleksi)                                                                                                                     | Slaude                    |
| Koleksi pengalaman         | Ringkasan sesi, facts regex                 | `syncTurn` per turn ke memory/brain                                                                                                                                   | Slaude                    |
| Ekstraksi pengetahuan      | Facts, summary, draft skill                 | `kb_memoize` oleh model; auto-evolve skill                                                                                                                            | Slaude (model-driven)     |
| Belajar dari kegagalan     | ✗                                           | ✗                                                                                                                                                                     | —                         |
| Auto skill create          | Draft (approval wajib sejak T-001)          | Model + kartu izin                                                                                                                                                    | Slaude                    |
| Auto skill update          | ✗ (draft baru)                              | Refine existing via overwrite                                                                                                                                         | Slaude                    |
| Memori task jangka panjang | Goals/kanban sebagai data                   | Brain slices + KB                                                                                                                                                     | Slaude                    |

## Penilaian

- **Planning terstruktur:** Anvio lebih kuat (DAG, orchestrator, workflow, goals). Slaude bergantung pada model.
- **Kelanjutan & penjadwalan andal:** Slaude jauh lebih kuat (antrean, lease, CAS cron, resume).
- **Learning:** keduanya _experience capture_, bukan loop umpan balik terukur. Slaude lebih efektif secara praktis karena keputusan "simpan sebagai skill" dibuat model dalam konteks penuh dan setiap tulis dikonfirmasi manusia; Anvio mengekstrak dari ringkasan dan (sebelum T-001) mempublish otomatis.
- Untuk use case Anvio (multi-channel, multi-provider), kombinasi terbaik: **planning Anvio + mekanisme kelanjutan/penjadwalan ala Slaude + auto-evolve ala Slaude yang melewati jalur draft & gate deterministik**.

## Pola terpilih

| Pola                                                     | Keputusan                                                 |
| -------------------------------------------------------- | --------------------------------------------------------- |
| CAS claim pada `next_run_at` sebelum dispatch cron       | ADOPT (T-027)                                             |
| Auto-evolve dalam sesi berbasis hitungan tool substantif | ADAPT (hanya turn sukses; output ke draft)                |
| `syncTurn` per turn ke memory                            | KEEP CURRENT (Anvio sudah menyimpan per turn)             |
| Belajar dari kegagalan                                   | Tidak ada di keduanya → tetap backlog Phase 2 (P2-LRN-05) |
