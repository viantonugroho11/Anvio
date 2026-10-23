# 11 — Implementation Roadmap

Menggabungkan roadmap Phase 2 ([08](../phase-2/08-prioritized-implementation-roadmap.md)) dengan task Phase 3. Prinsip tetap: korektness & keamanan sebelum ekstensibilitas. **Sistem plugin dijadwalkan setelah jalur eksekusi pihak ketiga yang sudah ada (MCP) benar dan aman**, karena plugin pertama yang masuk akal justru berbasis MCP.

## Milestone

| Milestone                                                                                           | Isi                                                                                                                                                                 | Exit criteria                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** ✅                                                                                           | T-001, T-002, T-003, T-005, T-012, T-020                                                                                                                            | Merged (PR #112)                                                                                                                                                 |
| **M1b — Hotfix Phase 3** (paralel, kecil)                                                           | **T-046** MCP stdio transport, **T-047** MCP secret isolation, **T-052** A2A secure defaults, **T-048** A2A client auth + timeout, T-007 env allow-list (diperluas) | Probe M1 lulus terhadap server SDK resmi; server MCP tidak melihat API key; probe A4 klien berhasil; card berisi `securitySchemes`; tanpa key → 401              |
| **M2 — Fondasi eksekusi** (Phase 2)                                                                 | T-004 SessionRunQueue, T-010 cancel, T-011 recovery, T-006 PolicyToolPort, T-008 budget, T-009 checkpoint                                                           | Lihat Phase 2                                                                                                                                                    |
| **M2b — A2A semantik**                                                                              | T-049 sesi per contextId & identitas, T-051 cancel, T-050 approval/stream/artifact                                                                                  | Interop I1–I4 ([02 §4](02-a2a-client-server-interoperability.md#4-rencana-test-interop-lanjutan-memerlukan-persetujuan-instalasi)) lulus dengan Python `a2a-sdk` |
| **M3 — Reliabilitas** (Phase 2) + T-017, T-042 (stub off), T-053, T-054, T-055, T-056, T-060, T-061 | Channel, MCP fidelity, A2A multi-agent & persistensi                                                                                                                | —                                                                                                                                                                |
| **M4 — Plugin fase 1**                                                                              | T-058 PluginManager (`isolated` via MCP, skill, model data), lockfile, CLI, enable/disable/update/uninstall/rollback                                                | Plugin contoh dari git@sha terpasang, tool muncul tanpa restart, disable mencabut, update gagal → rollback otomatis                                              |
| **M5 — Plugin fase 2**                                                                              | T-057 A2A extensions, T-059 tipe terbuka, plugin `trusted` (channel/memory/model adapter), install policy hook, scan                                                | Extension data-only contoh dinegosiasikan sesuai spec; channel plugin contoh tanpa edit core                                                                     |

## Urutan rinci M1b (rekomendasi langsung berikutnya)

1. **T-046** — tukar `McpStdioClient` ke SDK resmi (`Client` + `StdioClientTransport`), pertahankan antarmuka `McpBridge`. Regression: probe M1 sebagai test (server `McpServer` minimal di `packages/integrations/scripts/`). Ganti `mock-mcp-server.mjs`.
2. **T-047 + T-007** — satu helper `childEnv(entry)` untuk MCP, hook, dan code exec; `secrets:` eksplisit; validasi `mcp_manage` (tanpa `${…}`, allow-list default kosong).
3. **T-048** — `fetch` kustom di transport SDK untuk header auth + `AbortSignal.timeout(timeoutMs)`.
4. **T-052** — default aman A2A + `securitySchemes` + 401.

Semua S–M, independen satu sama lain kecuali 2 (memakai helper yang sama dengan T-007).

## Keputusan pemilik proyek

1. **Model kepercayaan plugin**: setuju default `isolated` (proses terpisah/MCP) untuk sumber eksternal, `trusted` in-process hanya dengan persetujuan eksplisit? (Rekomendasi: ya.)
2. **Sumber install yang didukung fase 1**: direktori lokal + git dengan pin SHA. npm menyusul setelah lockfile/integrity. Setuju?
3. **A2A default auth**: boleh mengubah perilaku sehingga `a2a.enabled: true` tanpa API key gagal boot (kecuali `allowAnonymous: true`)?
4. **Kompatibilitas A2A 0.3**: perlu didukung (jalur kompatibilitas) atau cukup 1.0?
