# 07 — Skills & Knowledge Comparison

## 1. Skills

| Aspek                 | Slaude (bukti)                                                                                                                                                         | Anvio (bukti)                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Struktur              | `~/.slaude/skills/<slug>/SKILL.md` (frontmatter + body, `${SLAUDE_SKILL_DIR}`, `${SLAUDE_SKILL_ARGS}`) — format Claude Code                                            | `workspace/skills/<slug>.md` atau `<slug>/SKILL.md`; format agentskills.io/Hermes juga diimpor |
| Discovery & loading   | Oleh CLI Claude Code (skill CC) + `skills/loader.ts`; invocation `/skill-name`                                                                                         | Catalog resolver + `agent.spec.skills` + trigger + goal                                        |
| Hot reload            | CLI membaca saat boot sesi (Unverified per-turn)                                                                                                                       | Ya (mtime trigger cache)                                                                       |
| Registrasi oleh agent | MCP `write_skill` / `delete_skill` (`skills/mcp-tools.ts:187-191`) — **melewati `canUseTool` → kartu izin** (tidak di allow-list statis, `permission-gate.ts:100-106`) | `skill_manage create/promote` (default off); learning loop draft                               |
| Validasi              | Skema kontrak tool (zod); detail validasi isi tidak diverifikasi                                                                                                       | Parse schema skill                                                                             |
| Persistensi           | File; `sync_manifest` push ke repo git (`skills/sync-manifest.ts:35-92`) → riwayat versi via git                                                                       | File; tanpa versi (T-019)                                                                      |
| Instalasi             | `slaude.json` + `slaude.lock` (pin SHA) via `cli/install.ts`                                                                                                           | `anvio skill import` (git tanpa pin SHA, T-061)                                                |
| Isolasi               | Per persona/home                                                                                                                                                       | Per workspace                                                                                  |

### Pembuatan/pembaruan otomatis

| Kapabilitas            | Slaude                                                                                                                                                    | Anvio                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deteksi otomatis       | Setelah turn dengan **≥2 tool substantif** (`manager.ts:1633-1650`), `SLAUDE_AUTO_EVOLVE` default on (`env.ts:518`)                                       | Draft per tool call / per run (setelah T-001 tidak dipublish otomatis) |
| Mekanisme              | Prompt sintetis `<auto-evolve>` disuntik ke **sesi yang sama** (`manager.ts:1600-1603,1671-1685`); model memutuskan create vs refine (membaca skill dulu) | Summarizer terpisah (LLM atau rules) membuat draft                     |
| Konteks keputusan      | Model melihat seluruh turn (termasuk hasil tool)                                                                                                          | Ringkasan pesan / output tool                                          |
| Update skill existing  | Ya ("refine existing" → `read_skill` lalu `write_skill` overwrite)                                                                                        | Draft baru; promote menolak overwrite tanpa `force`                    |
| Approval publish       | Kartu izin per `write_skill` (kecuali mode bypass / auto-allow env)                                                                                       | Draft wajib `/promote` (default sejak T-001)                           |
| Versi/rollback         | Via git bila `sync_manifest` dipakai; tanpa itu overwrite                                                                                                 | Tidak ada                                                              |
| Regression test skill  | Tidak ditemukan                                                                                                                                           | `SkillTestRunner` (CLI manual)                                         |
| Belajar dari kegagalan | Tidak (trigger hanya hitung tool, tidak menilai hasil)                                                                                                    | Tidak                                                                  |

**Kesimpulan:** Slaude memiliki auto-skill **berbasis model, dalam sesi, dengan gate izin per penulisan**. Kekuatannya: keputusan dibuat dengan konteks penuh dan tiap tulis butuh persetujuan manusia (dalam mode default). Kelemahannya: tanpa validasi, tanpa penilaian sukses, overwrite langsung.

## 2. Knowledge base

| Aspek               | Slaude                                                                                            | Anvio                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Engine              | gbrain (PGLite/Postgres) — `knowledge/brain.ts`                                                   | `packages/knowledge` (raw → wiki), gbrain sebagai memory provider opsional |
| Organisasi          | Scope `agent-<id>`, `user-<id>`, shared, KB terinstal (`knowledge/scope.ts`, `agent-identity.ts`) | Per workspace                                                              |
| Retrieval           | `kb_search`, `kb_think` (sintesis), `gather()` fan-out per source (`knowledge/gather.ts`)         | `memory_recall`, `session_search`, FTS5                                    |
| Penulisan           | `kb_memoize` default ke slice sendiri; ke shared → **kartu** (`knowledge/gated-dispatch.ts`)      | Facts regex (T-002), `storeEntry`                                          |
| Ingest              | `knowledge/ingest.ts`, KB dari git (lock SHA)                                                     | `anvio kb import-manifest`                                                 |
| Pemeliharaan otonom | "dream cycle" gbrain dengan advisory lock (`brain.ts:491-560`); detail siklus tidak diverifikasi  | Consolidation gbrain episodic (ADR 0035)                                   |
| Isolasi             | Slice per agent/user; `kbSources` = filter, **bukan** isolasi (field note 2026-10-05)             | Per user/session                                                           |

## 3. Rekomendasi

- **ADAPT** auto-evolve dalam sesi untuk runtime yang mendukungnya, tetapi lewat jalur draft + `PolicyToolPort` (gate deterministik), bukan publish langsung — dan hanya bila turn **berhasil** (tidak ada error/penolakan).
- **ADOPT** pemicu "≥2 tool substantif, abaikan tool interaksi/housekeeping" sebagai pengganti pemicu per-tool-call Anvio (mengurangi draft sampah, P2-SKL-03).
- **ADOPT** lock SHA untuk skill/KB dari git (T-061) dengan format lockfile.
- **ADAPT** slice memori per agent/user + tulis shared ber-gate.
- **KEEP CURRENT** `SkillTestRunner` dan format multi-sumber Anvio.
