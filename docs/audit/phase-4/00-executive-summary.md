# 00 — Executive Summary (Phase 4: Slaude Comparison)

| Item                 | Nilai                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tanggal              | 2026-10-23                                                                                                                                                                                                                                                       |
| Referensi            | `barockok/slaude` @ `7d2246970f343453dd3314c823099480f9f2f376`, versi `0.45.0-rc.9`, MIT                                                                                                                                                                         |
| Anvio                | `origin/main` @ `bd0a762` + PR #113 (belum merge)                                                                                                                                                                                                                |
| Metode               | Clone read-only; source Slaude dibaca langsung (agent manager, gateway, permission/approval gate, soul, sessions, queue, skills, knowledge, deploy). Kode dan test Slaude **tidak dijalankan**. Klaim dari field notes Slaude yang tidak dicek ke kode ditandai. |
| Perubahan kode Anvio | Tidak ada                                                                                                                                                                                                                                                        |

Dokumen: [01](01-slaude-architecture-analysis.md) · [02](02-agent-core-comparison.md) · [03](03-soul-and-persona-comparison.md) · [04](04-session-and-context-comparison.md) · [05](05-slack-and-channel-comparison.md) · [06](06-tool-and-approval-comparison.md) · [07](07-skills-and-knowledge-comparison.md) · [08](08-planning-and-learning-comparison.md) · [09](09-plugin-and-protocol-comparison.md) · [10](10-deployment-and-reliability.md) · [11](11-architecture-gap-matrix.md) · [12](12-previous-findings-reconciliation.md) · [13](13-adoption-recommendations.md) · [14](14-prioritized-roadmap.md)

## Jawaban 15 pertanyaan

**1. Perbedaan arsitektur utama?** Slaude adalah _runtime Slack di sekeliling Claude Agent SDK_: otak, loop, kompaksi, tool, MCP, dan plugin dari SDK; Slaude membangun gateway, antrean HA, gate izin, soul, sesi, dan operasional. Anvio adalah _platform multi-channel, multi-provider dengan otak sendiri_ plus runtime vendor opsional, A2A, workflow, goals.

**2. Kapabilitas Slaude yang lebih matang?** Gate izin per-tool deterministik (`canUseTool`); eksekusi andal (lock sesi, antrean, coalescing, redelivery, AbortController, idle TTL, resume); scrub env child; dedup event durable; approval durable lintas replika; cron dengan klaim CAS; integrasi Slack (HTTP mode, mrkdwn, mention-only durable, redaksi status); operasional HA (k8s, `/readyz`, drain, boot guard, simulator & fake Slack).

**3. Yang lebih baik di Anvio?** Fleksibilitas provider (18 vs Anthropic-compatible), cakupan channel (15 vs 1), protokol (A2A 1.0 server/klien vs tidak ada), planning terstruktur (DAG orchestrator, workflow, goals), identitas soul tertipe per agent, failover provider pra-chunk, tracing OTel, test runner skill, deployment Level 1 tanpa infrastruktur.

**4. Soul & isolasi persona Slaude?** Dua lapis: `RUNTIME_BASELINE` hard-coded (`soul/loader.ts:6-167`) + `<persona>` dari SOUL.md. SoulData (manager, channel, approver) diekstrak LLM → zod → **id yang tidak verbatim di SOUL.md menolak ekstraksi** → cache ber-HMAC (`soul/extract.ts`). Override per channel. Satu persona per deploy/persona gateway.

**5. Sesi persisten Slaude?** Kunci unik `(team, channel, thread_ts, persona)`; `claude_started` → resume transkrip SDK; idle TTL menutup loop SDK, pesan berikutnya boot dengan resume; lock sesi Redis + coalescing; turn yang hilang di-redeliver.

**6. Penegakan approval Slaude?** Dua lapis: (a) **setiap tool** melewati `canUseTool` → kebijakan statis murni → kartu Approve/Deny dengan baris `pending_gates` durable, guarded UPDATE, klik non-approver tidak mengonsumsi baris; (b) approval per-rencana yang dipicu model (`request_approval`) dengan approver dari SoulData. Lapis (a) independen dari model. Kelemahan: approver kosong = siapa pun boleh klik (jangan ditiru).

**7. Skills & knowledge Slaude?** Skill format Claude Code (`skills/<slug>/SKILL.md`); MCP `write/delete_skill` lewat gate izin; push ke git (`sync_manifest`); manifest + lock SHA untuk instalasi. Knowledge: gbrain dengan slice per agent/user, penulisan shared ber-gate, `kb_think`/`gather`.

**8. Learning loop sejati?** **Tidak.** Ada capture per turn dan auto-evolve skill; tidak ada evaluasi hasil, pengukuran, atau belajar dari kegagalan — sama seperti Anvio.

**9. Auto skill create/update?** **Ya, berbasis model.** Setelah turn dengan ≥2 tool substantif, prompt `<auto-evolve>` disuntik ke sesi yang sama; model membuat atau memperbarui skill via `write_skill`, yang (pada mode default) meminta persetujuan per penulisan. Tanpa validasi, versi (kecuali push git), atau test.

**10. Plugin yang dapat diinstal?** Plugin **Claude Code** via `slaude.json` + `slaude.lock` (pin SHA) dan `Options.plugins` SDK — konfigurasi, bukan plugin manager runtime.

**11. A2A/ACP/MCP Slaude?** A2A: tidak ada. ACP: tidak ada. MCP: klien via CLI (standar), server in-process SDK, `brain-server` MCP remote ber-OAuth.

**12. Pola yang diadopsi?** ADOPT: scrub env + placeholder rahasia tidak di-expand (R-02), runtime baseline (R-03), dedup durable (R-04), approval durable guarded (R-06), AbortController (R-10), redaksi (R-11), cron CAS (R-12), lockfile `--check` (R-13), `/readyz`+drain+boot guard (R-15). ADAPT: gate izin per-tool deterministik (R-01), antrean+lock+coalescing Level 1 (R-05), cache policy ber-HMAC (R-08), auto-evolve ke jalur draft (R-14), breaker (R-16), fake platform e2e (R-17).

**13. Yang tidak diadopsi?** REJECT: mengganti otak dengan SDK (R-18), Slack-only (R-19), approver kosong = siapa pun (R-07), `git clone` via shell string (R-21). DEFER: Redis/k8s/Vault sebagai syarat (R-20), override soul per channel (R-09), brain MCP server (R-22).

**14. Temuan lama yang belum selesai?** Phase 1: 33 dari 35 (hanya G-01, G-02 fixed). Phase 2: 39 dari 45 (M1 fixed). Phase 3: 16 dari 16. Fix trash (`68294da`) menunggu merge PR #113. Dokumen parity internal (`docs/50`, `docs/51`) melebih-lebihkan paritas Slaude (mis. MCP stdio ✅).

**15. Yang harus diimplementasikan berikutnya?** M1b (T-046, T-047+T-007, T-048, T-052) **+ T-064 runtime baseline**, lalu **T-006 gate izin per-tool deterministik** sebagai awal M2, kemudian T-004 (antrean per sesi + coalescing) yang membuka T-010/T-011/T-065. Detail: [14](14-prioritized-roadmap.md).

## Ringkasan satu kalimat

Jangan meniru otak Slaude — tiru **disiplin di sekelilingnya**: setiap tool lewat gate deterministik, child tanpa secret, satu run per sesi, event dideduplikasi secara durable, dan baseline instruksi yang tidak bisa ditimpa.
