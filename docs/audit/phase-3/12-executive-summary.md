# 12 — Executive Summary (Phase 3: A2A & Plugin System)

| Item                       | Nilai                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tanggal                    | 2026-10-23                                                                                                                                      |
| Kode diaudit               | `main` @ `bd0a762`                                                                                                                              |
| Spesifikasi                | A2A 1.0.0 (`a2aproject/A2A@98279d623163`); A2A Extensions (`a2a-protocol.org/latest/topics/extensions`); MCP transports 2025-06-18              |
| SDK                        | `@a2a-js/sdk@1.3.0` (terbaru di npm; repo `a2aproject/a2a-js@b9402fdbda93`); `@modelcontextprotocol/sdk@1.30.0` (transitif; npm terbaru 1.32.1) |
| Referensi                  | Hermes Agent `67491b50f7e5` (docs plugins), OpenClaw `163776f2b7e6` (docs plugins), Orca `22a95c4efe7e`                                         |
| Bukti dieksekusi           | 4 probe A2A wire-level (server Anvio asli + klien SDK resmi + JSON-RPC mentah), 1 probe MCP (klien Anvio vs server SDK MCP resmi)               |
| Perubahan kode / instalasi | Tidak ada. Tidak ada plugin pihak ketiga diinstal atau dijalankan; server MCP uji dibangun dari SDK resmi yang sudah ada di `node_modules`      |

Dokumen: [00](00-previous-findings-reconciliation.md) · [01](01-a2a-protocol-compliance.md) · [02](02-a2a-client-server-interoperability.md) · [03](03-plugin-system-architecture.md) · [04](04-plugin-installation-lifecycle.md) · [05](05-a2a-plugin-integration.md) · [06](06-plugin-security-isolation.md) · [07](07-plugin-error-handling.md) · [08](08-plugin-extension-points.md) · [09](09-architecture-recommendations.md) · [10](10-remaining-gap-breakdown.md) · [11](11-implementation-roadmap.md)

## Penilaian keseluruhan

**A2A:** kepatuhan wire 1.0 baik karena memakai SDK resmi — klien SDK resmi dapat mengirim pesan dan membaca task Anvio. Semantiknya lemah: tiap pesan sesi baru, semua pemanggil satu identitas, approval dilaporkan selesai, streaming diiklankan tapi tidak ada, cancel tidak menghentikan run, auth default off, dan **klien Anvio tidak pernah mengirim kredensial yang dikonfigurasi**.

**Plugin:** tidak ada sistem plugin. Ada mekanisme ekstensi terpisah (MCP, skill, hook, model OpenAI-compatible). Port-port arsitekturnya cocok sebagai titik ekstensi, tetapi lapisan kepercayaan/lifecycle belum ada — dan jalur yang hari ini sudah menjalankan kode pihak ketiga (MCP stdio, hook) **mewarisi semua secret proses**.

**Temuan terbesar audit ini:** klien MCP stdio Anvio memakai framing `Content-Length` sehingga **tidak dapat initialize ke server MCP standar** (timeout 30 s, lalu jatuh ke tool stub). Ini mengoreksi penilaian Phase 1.

## Jawaban 15 pertanyaan

1. **Apakah A2A berfungsi sebagai client & server?** Server: **ya** untuk 1.0 tanpa auth atau dengan header manual (probe A2/A3). Client: **ya tanpa auth; gagal untuk remote yang butuh auth** (probe A4).
2. **Bisa discover & delegasi ke agent A2A eksternal?** Delegasi: ya, via tool `a2a_delegate` (default off) ke remote yang ditulis di `anvio.yaml`. Discovery: card diambil SDK, tetapi tidak ada registry/pemilihan berbasis kapabilitas; remote baru perlu restart.
3. **Ada plugin manager nyata?** **Tidak.**
4. **Bisa install plugin pihak ketiga hari ini?** Tidak sebagai "plugin". Yang bisa: skill (dir/git/URL katalog) dan server MCP (YAML/`mcp_manage`) — keduanya tanpa verifikasi integritas.
5. **Sumber yang didukung?** Skill: direktori lokal, git (tanpa pin SHA), katalog bundled/URL. MCP: perintah lokal / `npx`/`uvx` (registry publik, tanpa pin) / URL HTTPS. Plugin umum: tidak ada.
6. **Enable/disable/update/uninstall?** MCP: enable/disable/remove (hot). Skill: install/upgrade (overwrite)/remove. Tidak ada rollback di keduanya.
7. **A2A sebagai plugin?** Tidak — server & klien di-hard-wire di `platform/src/index.ts`.
8. **Plugin dapat mendaftarkan tool & model provider?** Tool: hanya via MCP. Model: hanya endpoint OpenAI-compatible via konfigurasi; `ModelProviderRegistry.upsert` ada tetapi tidak diekspos ke pihak luar.
9. **Plugin dapat mendaftarkan A2A extension?** Tidak; `capabilities.extensions` hard-coded kosong, tidak ada negotiator.
10. **Load tanpa restart?** MCP & skill: ya. Channel, runtime, provider non-OpenAI, tool built-in, remote A2A: tidak (butuh restart; sebagian butuh perubahan kode).
11. **Bila plugin crash?** Proses MCP crash: diisolasi, respawn maks 3; server gagal init → **tool stub palsu** muncul. Promise tanpa catch: tidak lagi menjatuhkan proses (T-005). Exception sinkron in-process: proses exit (sengaja).
12. **Izin & secret terisolasi?** **Tidak.** MCP stdio & hook mewarisi `process.env`; `${VAR}` di header MCP remote dapat mengirim secret ke host mana pun; tidak ada manifest izin; ekstensi dapat membaca soul, memory, sesi, dan konfigurasi workspace.
13. **Temuan lama yang belum selesai?** 31 temuan Phase 1 & 39 task Phase 2 belum selesai; 2 + 6 sudah selesai. G-12/G-13 kini dinilai lebih parah (G-33). Lihat [00](00-previous-findings-reconciliation.md).
14. **Perubahan arsitektur yang perlu?** (a) transport MCP sesuai spec; (b) env allow-list untuk semua proses anak; (c) PolicyToolPort; (d) perbaikan semantik & default keamanan A2A; (e) `PluginManager` di composition root yang menyuplai port yang sudah ada (bukan dipanggil agent brain), dengan lockfile, trust level `isolated`/`trusted`, dan manifest izin; (f) `A2AExtensionRegistry` milik core.
15. **Urutan?** M1b (T-046, T-047, T-048, T-052, T-007) → M2 (fondasi eksekusi Phase 2) → M2b (semantik A2A) → M3 → M4 (plugin fase 1, berbasis MCP/skill/model data) → M5 (A2A extensions, plugin trusted, tipe terbuka). Detail: [11](11-implementation-roadmap.md).

## Scorecard Phase 3

| Kategori                    | Skor (0–5) | Bukti                                                                               | Main gap                     |
| --------------------------- | ---------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| A2A wire compliance (1.0)   | 4          | SDK resmi; probe A2/A3 lulus; negosiasi versi benar                                 | Error auth 500               |
| A2A semantik server         | 2          | Task berjalan; sesi/identitas/approval/stream/cancel salah                          | P3-A2A-03/04/05/08           |
| A2A client                  | 2          | Delegasi OK tanpa auth                                                              | Auth & timeout tidak dipakai |
| A2A security                | 1          | Auth tersedia tapi default off; push SSRF                                           | P3-A2A-06/07                 |
| A2A extensions              | 0          | —                                                                                   | Tidak ada                    |
| MCP client                  | 1          | stdio **tidak kompatibel** (probe M1); HTTP tidak diuji pada audit ini (Unverified) | G-33                         |
| Plugin manager / lifecycle  | 0          | —                                                                                   | Tidak ada                    |
| Mekanisme ekstensi existing | 2          | MCP & skill hot; skill installer                                                    | Tanpa versi/rollback/izin    |
| Isolasi & secret            | 0          | Proses anak mewarisi semua env                                                      | P3-SEC-01/02                 |
