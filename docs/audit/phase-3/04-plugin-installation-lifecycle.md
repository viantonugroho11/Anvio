# 04 — Plugin Installation & Lifecycle

Karena tidak ada plugin manager ([03](03-plugin-system-architecture.md)), skenario di bawah dinilai terhadap mekanisme yang paling dekat: **skill** (satu-satunya yang punya installer) dan **MCP server** (satu-satunya yang menjalankan kode pihak ketiga dan dapat ditambah saat runtime).

## 1. Sepuluh skenario instalasi

| #   | Skenario                        | Skill                                                                                                                                                         | MCP server                                                                                           | Plugin (umum) | Bukti                                                    |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| 1   | Dari direktori lokal            | IMPLEMENTED (`installFromDir`, `anvio skill import <dir>`)                                                                                                    | IMPLEMENTED (entri YAML `command` + path)                                                            | MISSING       | `skill-installer.ts:42`; `skill-import.ts`               |
| 2   | Dari Git                        | IMPLEMENTED — `git clone --depth 1 [--branch ref] -- url` (`skill-import.ts:29-32`), temp dir selalu dihapus; **tanpa pin SHA** (`--branch` hanya branch/tag) | MISSING (bisa via `npx github:…`, tidak dikelola)                                                    | MISSING       | —                                                        |
| 3   | Dari package registry           | MISSING                                                                                                                                                       | PARTIAL — `npx <pkg>` / `uvx <pkg>` men-download saat start, tanpa pin/lock bila versi tidak ditulis | MISSING       | `core/src/schemas/mcp.schema.ts:44`                      |
| 4   | Dari remote manifest / registry | PARTIAL — `install(slug)` dari katalog (bundled/URL)                                                                                                          | MISSING                                                                                              | MISSING       | `skill-installer.ts:25`                                  |
| 5   | Validasi sebelum install        | PARTIAL — parse schema `SKILL.md`; `--path` tidak boleh keluar source                                                                                         | MISSING (validasi id & allow-list command hanya untuk jalur agent)                                   | MISSING       | `skill-import.ts:70-73`; `platform/src/index.ts:843-884` |
| 6   | Resolusi dependensi             | MISSING                                                                                                                                                       | MISSING                                                                                              | MISSING       | —                                                        |
| 7   | Enable/disable                  | PARTIAL (aktivasi via agent/trigger; tidak ada flag)                                                                                                          | IMPLEMENTED (`enabled`)                                                                              | MISSING       | `integration-registry.ts`                                |
| 8   | Update                          | PARTIAL (`upgrade`, overwrite)                                                                                                                                | PARTIAL (edit YAML; `npx` tanpa versi = update diam-diam)                                            | MISSING       | `skill-installer.ts:56-75`                               |
| 9   | Rollback update gagal           | MISSING                                                                                                                                                       | MISSING                                                                                              | MISSING       | —                                                        |
| 10  | Uninstall & cleanup             | PARTIAL (`remove` file + manifest)                                                                                                                            | PARTIAL (`remove` entri + `invalidate` client)                                                       | MISSING       | `skill-installer.ts:82`; `platform/src/index.ts:846-850` |

## 2. Lifecycle aktual (MCP, satu-satunya yang hot)

```mermaid
flowchart TD
  A[Operator edit mcp/servers.yaml<br/>atau agent mcp_manage add] --> B{Jalur agent?}
  B -->|ya| C[validasi id regex<br/>command ∈ agentAllowedCommands<br/>url https]
  B -->|tidak| D[tanpa validasi]
  C --> E[integrationRegistry.upsert]
  D --> E
  E --> F[mcpBridge.invalidate + reloadMcpCatalog]
  F --> G[spawn proses: env = process.env + resolve ${VAR}]
  G --> H{initialize stdio}
  H -->|framing Content-Length tidak cocok server standar| I[timeout 30 s → fallback tool stub ⚠ G-33]
  H -->|server memakai framing yang sama| J[tools/list → katalog]
  J --> K[first-call approval per sesi]
```

Hot load: **ya** untuk MCP (katalog di-swap tanpa restart, ADR-0036) dan skill (dibaca dari disk, trigger cache berbasis mtime). Hot unload: MCP `remove` + `invalidate`. Tidak ada rollback, health check periodik, atau quarantine.

## 3. Lifecycle kandidat dari brief — status per langkah

| Langkah                      | Status hari ini                                   |
| ---------------------------- | ------------------------------------------------- |
| Discover                     | Skill catalog saja                                |
| Inspect manifest             | Tidak ada manifest plugin                         |
| Validate source & signature  | Tidak ada signature/hash; git tanpa pin SHA       |
| Resolve dependencies         | Tidak ada                                         |
| Check permissions            | Tidak ada manifest izin                           |
| Install                      | Skill & MCP (lihat atas)                          |
| Register capabilities        | MCP tools via katalog; skill via loader           |
| Enable                       | MCP flag                                          |
| Health check                 | MCP `getHealthReport` (on demand, bukan periodik) |
| Runtime execution            | Ya                                                |
| Update / Disable / Uninstall | Parsial, tanpa rollback                           |

## 4. Restart

| Jenis                                                   | Perlu restart?                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| MCP server                                              | Tidak                                                            |
| Skill                                                   | Tidak                                                            |
| Hook                                                    | Tidak diverifikasi (engine memuat YAML; reload tidak ditelusuri) |
| Channel / provider non-OpenAI / runtime / tool built-in | **Ya — dan perlu perubahan kode + rebuild**                      |
| A2A remote                                              | Ya (dibaca sekali saat boot, `platform/src/index.ts:1018-1037`)  |

## 5. Rekomendasi sumber yang didukung

Urutan dari paling aman:

1. **Direktori lokal** (dev, `--link`) — sudah ada untuk skill.
2. **Git dengan pin commit SHA 40 karakter** — tambah pin SHA (Hermes mewajibkannya untuk pinning).
3. **npm dengan versi exact + integrity (lockfile per plugin)** — untuk plugin kode; hindari `npx <pkg>` tanpa versi.
4. Registry/katalog terkurasi — nanti, setelah signature.

Tidak disarankan: URL arbitrer ke file `.js`, `npx` tanpa versi, install oleh agent tanpa persetujuan manusia.
