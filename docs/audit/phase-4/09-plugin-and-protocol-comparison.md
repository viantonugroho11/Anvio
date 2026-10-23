# 09 — Plugin & Protocol Comparison

## 1. Plugin & ekstensibilitas

| Aspek                    | Anvio                                                      | Slaude (bukti)                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin manager runtime   | ✗ ([Phase 3](../phase-3/03-plugin-system-architecture.md)) | ✗ — tidak ada manager runtime; instalasi via CLI                                                                                                                             |
| Manifest dependensi      | ✗                                                          | `slaude.json` (deklarasi) + `slaude.lock` (pin SHA) untuk **plugin Claude Code (marketplace)**, skill, KB (`cli/install.ts:107-134`, `--check`)                              |
| Plugin yang didukung     | —                                                          | Plugin Claude Code (skills, commands, hooks, agents) dimuat via `Options.plugins`; `.mcp.json` plugin dibaca manual karena SDK tidak me-mount-nya (`config/plugins.ts:1-12`) |
| Tool extension           | MCP; built-in di kode                                      | MCP; server in-process SDK                                                                                                                                                   |
| External MCP             | YAML + `mcp_manage`                                        | `mcp.json` + `/mcp connect` OAuth; kredensial di store terenkripsi gateway, dipilih per call (field note 2026-09-18)                                                         |
| Skill install            | dir/git/URL                                                | manifest + lock                                                                                                                                                              |
| Skill hot reload         | Ya                                                         | Saat boot sesi (Unverified)                                                                                                                                                  |
| Model provider extension | 18 built-in + custom endpoint                              | Hanya endpoint Anthropic-compatible                                                                                                                                          |
| Channel extension        | Kode                                                       | Tidak (Slack-only by design)                                                                                                                                                 |
| Update                   | Skill overwrite                                            | `install --update` memperbarui lock                                                                                                                                          |
| Isolasi                  | ✗                                                          | Child env di-scrub; plugin CC berjalan di child CLI yang sama (in-process ke CLI)                                                                                            |
| Izin                     | ✗                                                          | Tool plugin tetap lewat `canUseTool`                                                                                                                                         |
| Lifecycle                | —                                                          | install / check / update; uninstall Unverified                                                                                                                               |

**Kesimpulan:** Slaude **tidak** memiliki plugin manager dinamis; yang ada adalah **ekstensi berbasis konfigurasi dengan lockfile** dan ketergantungan pada format plugin Claude Code. Pola yang patut ditiru: **lockfile ber-SHA + mode `--check`**, dan "tool apa pun dari plugin tetap melewati gate izin yang sama".

Catatan keamanan Slaude (jangan ditiru): `cli/install.ts:70-75` merangkai `git clone … ${url}` ke `execSync` (shell string). Manifest dikendalikan operator sehingga risiko rendah, tetapi Anvio sudah lebih aman (`execFile` + `--`, `skill-import.ts:29-32`).

## 2. Protokol

| Kapabilitas              | Anvio (Phase 3)                  | Slaude                                                                                                                                            |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A server               | ✔ SDK resmi 1.0 (semantik lemah) | ✗ (grep `a2a`/`agent-card` di `src/` kosong)                                                                                                      |
| A2A client               | ✔ tanpa auth (P3-A2A-01)         | ✗                                                                                                                                                 |
| Agent Card discovery     | ✔                                | ✗                                                                                                                                                 |
| Delegasi task jarak jauh | ✔ `a2a_delegate`                 | ✗ (delegasi hanya via subagent CLI)                                                                                                               |
| ACP agent                | ✗ (G-07)                         | ✗                                                                                                                                                 |
| MCP client               | stdio rusak (G-33), HTTP         | ✔ via CLI Claude Code (framing standar SDK)                                                                                                       |
| MCP server               | ✗                                | ✔ `slaude brain-server` (MCP remote ber-OAuth, guard JWT + RFC 9728 PRM — field note 2026-06-20; kode `knowledge/server/*`) dan server in-process |
| Adapter protokol         | A2A, "ACP" HTTP, REST            | REST `/v1` (node↔gateway), portal, panel                                                                                                          |

Pola integrasi Slaude yang berguna untuk Anvio:

- **Gateway sebagai pemegang kredensial**: node/child hanya menerima access token; refresh single-flight di gateway (field note 2026-09-18). Relevan untuk kredensial remote A2A (T-060) dan MCP (T-047).
- **Brain sebagai server MCP** dengan resource-guard JWT: pola untuk mengekspos memory/KB Anvio ke agent lain tanpa A2A.
