# 00 — Rekonsiliasi Temuan Phase 1 & Phase 2

| Item                         | Nilai                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tanggal                      | 2026-10-23                                                                                                                                       |
| Kode diverifikasi            | `main` @ `bd0a762` (merge PR #112)                                                                                                               |
| Baseline                     | Phase 1 [`docs/audit/`](../00-executive-summary.md) @ `952fda3`; Phase 2 [`docs/audit/phase-2/`](../phase-2/10-executive-summary.md) @ `a7e3a06` |
| Perubahan kode sejak Phase 2 | Hanya PR #112 (`4d47977`): T-001, T-002, T-003, T-005, T-012, T-020                                                                              |

## 1. Status ringkas

| Sumber                        | FIXED          | PARTIALLY FIXED | NOT FIXED | REGRESSION | OBSOLETE | Koreksi                                                |
| ----------------------------- | -------------- | --------------- | --------- | ---------- | -------- | ------------------------------------------------------ |
| Phase 1 (G-01…G-32, S-4, S-9) | 2 (G-01, G-02) | 0               | 31        | 0          | 0        | **1 baru** (G-12/G-13 lebih parah dari dilaporkan, §3) |
| Phase 2 backlog (T-001…T-045) | 6              | 0               | 39        | 0          | 0        | —                                                      |

## 2. Phase 2 — verifikasi M1 (PR #112)

| Task                            | Finding                | Status                            | Bukti                                                                                                                                      |
| ------------------------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| T-001                           | P2-LRN-01 / P2-SKL-01  | **FIXED**                         | `learning-safety.spec.ts` (3 test); `requireApproval` default `true` (`core/src/schemas/soul.schema.ts`); probe Q2 tidak lagi mereproduksi |
| T-002                           | P2-LRN-02 / P2-SOUL-02 | **FIXED**                         | `learning-safety.spec.ts` (dedup + filter), `soul-save.spec.ts` (label + dedup render)                                                     |
| T-003                           | P2-SOUL-01             | **FIXED** (dengan batas tercatat) | `soul-save.spec.ts` (2 test). Batas: `create()` atas slug tanpa file dan tanpa source tidak punya bagian policy untuk dipertahankan        |
| T-005                           | P2-CH-06               | **FIXED**                         | `channel-isolation.spec.ts`; `installProcessErrorGuards` di 4 entrypoint                                                                   |
| T-012                           | P2-CH-02               | **FIXED**                         | `channel-isolation.spec.ts`; probe Q5 tidak lagi mereproduksi                                                                              |
| T-020                           | P2-SOUL-03 / P2-LRN-04 | **FIXED (code-read)**             | `resolveLearningSoul` di `platform/src/index.ts`; tidak ada unit test langsung (platform) — sebaiknya ditambah                             |
| T-004, T-006…T-011, T-013…T-045 | —                      | NOT FIXED                         | Tidak ada perubahan kode di area terkait                                                                                                   |

CI PR #112: Build & Typecheck, Lint, Test — semua PASS sebelum merge.

## 3. Phase 1 — revalidasi area yang relevan dengan Phase 3

| ID   | Area                                                  | Status                      | Catatan                                                                                                           |
| ---- | ----------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| G-05 | Tool policy (`agent.spec.tools`, approvals, tool-bus) | NOT FIXED                   | Relevan untuk plugin: tidak ada titik enforcement untuk tool yang didaftarkan pihak ketiga                        |
| G-06 | Sandbox env leak                                      | NOT FIXED                   | Diperluas: **server MCP stdio** juga menerima seluruh `process.env` (lihat [06](06-plugin-security-isolation.md)) |
| G-07 | ACP bukan Agent Client Protocol                       | NOT FIXED                   | Probe P8 masih reproduksi                                                                                         |
| G-12 | MCP `inputSchema` dibuang                             | NOT FIXED — **lebih parah** | Lihat koreksi di bawah                                                                                            |
| G-13 | MCP `isError` hilang                                  | NOT FIXED — **lebih parah** | Idem                                                                                                              |
| G-17 | SSRF                                                  | NOT FIXED                   | Diperluas: push notification A2A (lihat [01](01-a2a-protocol-compliance.md))                                      |
| G-26 | MCP stub memalsukan sukses                            | NOT FIXED                   | Dampaknya naik karena stdio nyata gagal → fallback stub (§3)                                                      |

### Koreksi — klien MCP stdio tidak dapat berbicara dengan server MCP standar

Phase 1 ([06-mcp-and-tools.md](../06-mcp-and-tools.md)) menilai "MCP client stdio: **Implemented**". Itu salah.

`packages/integrations/src/mcp-stdio-client.ts:49,174-184` membingkai pesan dengan header `Content-Length: N\r\n\r\n` (gaya LSP). Spesifikasi MCP (transports, 2025-06-18) menyatakan pesan stdio **dibatasi newline dan tidak boleh berisi newline**. Probe M1 (audit ini) menjalankan `McpStdioClient` terhadap server stdio yang dibangun dengan `@modelcontextprotocol/sdk@1.30.0` (`McpServer` + `StdioServerTransport`):

```text
[M1] {"outcome":"error:MCP request timeout: initialize","elapsedMs":30002}
```

Server yang sama menjawab `initialize` dan `tools/list` dengan benar ketika diberi JSON per baris. Akibat:

- Setiap server MCP stdio standar (`npx @modelcontextprotocol/server-*`, server Python `mcp`) gagal initialize setelah 30 s.
- `McpBridge.listTools` lalu jatuh ke **tool stub** (`mcp-bridge.ts:50-53`), sehingga katalog menampilkan tool palsu (`ping`, atau `create_issue`/`search_code` untuk id `github`).
- Test yang ada lulus karena server uji `packages/integrations/scripts/mock-mcp-server.mjs` juga memakai framing `Content-Length` — klien dan mock sepakat satu sama lain, bukan dengan spesifikasi.
- G-12/G-13 tetap valid untuk transport HTTP (yang memakai JSON per request).

Status baru: **G-33 (Critical) — MCP stdio framing tidak sesuai spesifikasi.** Masuk backlog sebagai T-046.

## 4. Pekerjaan tersisa yang relevan Phase 3

Backlog lengkap ada di [10-remaining-gap-breakdown.md](10-remaining-gap-breakdown.md). Item lama yang menjadi prasyarat sistem plugin:

| Task lama                    | Kenapa prasyarat plugin                           |
| ---------------------------- | ------------------------------------------------- |
| T-006 PolicyToolPort (G-05)  | Tool dari plugin harus melewati policy yang sama  |
| T-007 env allow-list (G-06)  | Plugin/MCP proses tidak boleh mewarisi secret     |
| T-004 SessionRunQueue        | Plugin channel tidak boleh memblokir loop inbound |
| T-017 MCP fidelity (G-12/13) | Plugin MCP bergantung pada klien MCP yang benar   |
| T-019 versioned skills       | Plugin skill butuh versi & rollback               |
