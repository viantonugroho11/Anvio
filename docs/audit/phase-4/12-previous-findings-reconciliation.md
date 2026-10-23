# 12 — Previous Findings Reconciliation

| Item                         | Nilai                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Kode diverifikasi            | `origin/main` @ `bd0a762` + branch `docs/audit-phase-3-a2a-plugins` (PR #113, **belum merge**: dokumen Phase 3 + fix `68294da` trash) |
| Perubahan kode sejak Phase 3 | Hanya `68294da` (fix tabrakan nama entri trash), belum di `main`                                                                      |

## 1. Ringkasan status

| Sumber                      | FIXED                                                       | PARTIALLY FIXED | NOT FIXED | REGRESSION | OBSOLETE |
| --------------------------- | ----------------------------------------------------------- | --------------- | --------- | ---------- | -------- |
| Phase 1 G-01…G-33, S-4, S-9 | 2 (G-01, G-02)                                              | 0               | 33        | 0          | 0        |
| Phase 2 T-001…T-045         | 6 (M1)                                                      | 0               | 39        | 0          | 0        |
| Phase 3 T-046…T-061         | 0                                                           | 0               | 16        | 0          | 0        |
| Di luar backlog             | 1 (trash name collision, `68294da`, menunggu merge PR #113) | —               | —         | —          | —        |

Tidak ada regresi: tidak ada perubahan kode di area temuan selain yang tercatat.

## 2. Temuan yang dikaitkan dengan pola Slaude (ID tidak diubah)

| ID / Task                            | Status    | Pola Slaude terkait                                                    | Pembaruan acceptance criteria                                                                                                                   |
| ------------------------------------ | --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| G-05 / T-006 (policy tool)           | NOT FIXED | `canUseTool` + `permissionPolicy` statis (`permission-gate.ts:57-120`) | Tambah: **setiap** tool call runtime lokal melewati satu fungsi kebijakan murni yang juga dipakai runtime vendor; test unit kebijakan tanpa I/O |
| G-06 / T-007 (env sandbox)           | NOT FIXED | `scrubChildEnv` (`agent/child-env.ts`)                                 | Tambah: berlaku juga untuk child `claude-code` runtime (`buildClaudeCodeAgentEnv` meneruskan semua env kecuali key Anthropic)                   |
| T-047 (MCP secrets)                  | NOT FIXED | Placeholder `.mcp.json` **tidak** di-expand untuk variabel ter-scrub   | Tambah: `${VAR}` yang ada di denylist dibiarkan literal + WARN                                                                                  |
| G-09 / T-004 (lock sesi)             | NOT FIXED | `queue/locks.ts`, coalescing `queue/turns.ts`                          | Tambah: pesan yang datang saat run berjalan di-_coalesce_ ke run berikutnya, bukan run paralel                                                  |
| G-10 / T-010 (cancel)                | NOT FIXED | `AbortController` per sesi diteruskan ke SDK                           | —                                                                                                                                               |
| P2-PLAN-03 / T-011 (recovery)        | NOT FIXED | Reaper + lease + redelivery                                            | —                                                                                                                                               |
| P2-PLAN-01/02 / T-027 (cron)         | NOT FIXED | CAS `next_run_at` sebelum dispatch                                     | Tambah: occurrence diklaim sebelum dijalankan                                                                                                   |
| P2-CH-08 / T-014 (dedup)             | NOT FIXED | `SeenEvents.tryInsert` durable                                         | Tambah: dedup bertahan restart                                                                                                                  |
| P2-CH-05 / T-026 (error user)        | NOT FIXED | redaksi `status-text.ts`, OAuth error tidak diekspos                   | Tambah: redaksi path/command/URL/secret                                                                                                         |
| T-005 (crash guard)                  | FIXED     | Slaude juga punya circuit breaker                                      | Usulan baru T-062 (breaker)                                                                                                                     |
| T-003 (soul lossless)                | FIXED     | Cache SoulData ber-HMAC                                                | Usulan baru T-063 (integritas cache policy)                                                                                                     |
| T-019 / T-061 (skill versi, pin SHA) | NOT FIXED | `slaude.lock` + `sync_manifest` git                                    | Tambah: lockfile dengan `--check`                                                                                                               |
| G-33 / T-046 (MCP stdio)             | NOT FIXED | Slaude memakai klien MCP SDK/CLI standar                               | —                                                                                                                                               |
| G-07 (ACP)                           | NOT FIXED | Slaude juga tidak punya                                                | —                                                                                                                                               |

## 3. Koreksi dokumen internal Anvio

`docs/50-hermes-slaude-parity.md` mengklaim paritas Slaude "~94%" dan `docs/51-gap-hermes-slaude.md` T7 menandai "MCP … stdio client ✅". Audit ini dan Phase 3 menunjukkan:

- stdio MCP tidak kompatibel dengan server standar (G-33);
- gate izin per-tool deterministik (inti keamanan Slaude) tidak ada di runtime lokal Anvio;
- antrean/lock/recovery Slaude tidak ada padanannya.

Dokumen parity tersebut sebaiknya diperbarui atau ditandai usang (bukan bagian dari audit ini; tidak diubah).
