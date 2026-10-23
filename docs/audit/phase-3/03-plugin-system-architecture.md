# 03 — Plugin System Architecture

## 1. Kesimpulan

**Tidak ada sistem plugin.** Tidak ada plugin manager, registry, manifest, loader, atau lifecycle plugin di codebase: string `plugin` tidak muncul di satu pun file TypeScript di `packages/` maupun `apps/` (grep, di luar `node_modules`/`dist`).

Yang ada adalah **beberapa mekanisme ekstensi berbasis konfigurasi/data**, masing-masing dengan registry dan aturan sendiri:

| Mekanisme        | Unit                                            | Lokasi                                                                                              | Sumber install                                          | Kode pihak ketiga dieksekusi?                                                                   |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MCP integrations | server MCP (proses/URL)                         | `workspace/mcp/servers.yaml`; `integrations/src/integration-registry.ts`; tool `mcp_manage`         | YAML manual, CLI, agent (`mcp_manage add`, default off) | **Ya** — proses stdio (`npx`, `uvx`, `node`, `python3`, `docker` diizinkan default untuk agent) |
| Skills           | `SKILL.md` + folder (`scripts/`, `references/`) | `skills/src/skill-installer.ts`, `skill-import.ts`                                                  | bundled, URL katalog, direktori lokal, **git clone**    | Tidak langsung; `scripts/` dapat dijalankan agent lewat tool shell bila aktif                   |
| Event hooks      | handler `script` / `webhook` / `mcp`(stub)      | `hooks/src/hook-engine.ts`, `handlers/*`                                                            | YAML workspace                                          | **Ya** — `script` men-spawn file dengan `env: process.env` (`handlers/script.ts:24-27`)         |
| Runtimes         | backend eksekusi                                | `runtimes/src/runtime-factory.ts`                                                                   | statis di kode                                          | n/a                                                                                             |
| Model providers  | adapter                                         | `models/src/provider-catalog.ts`, `provider-factory.ts`; frontmatter `provider: custom` + `baseUrl` | statis + konfigurasi endpoint                           | Tidak (hanya endpoint HTTP)                                                                     |
| Channels         | adapter                                         | `channels/src/create-channels.ts`                                                                   | statis di kode                                          | n/a                                                                                             |
| Blueprints       | template                                        | `blueprints/src/catalog-registry.ts`                                                                | katalog repo                                            | Tidak (template)                                                                                |
| A2A remotes      | agent jarak jauh                                | `anvio.yaml` `a2a.remotes`                                                                          | konfigurasi                                             | Tidak lokal (HTTP)                                                                              |

## 2. Penilaian kapabilitas plugin manager

| Kapabilitas           | Status  | Catatan                                                                                          |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Plugin manager        | MISSING | —                                                                                                |
| Plugin registry       | MISSING | Ada registry per jenis (MCP YAML, skill manifest `_installed/manifest.yaml`)                     |
| Manifest              | MISSING | Skill memakai frontmatter; MCP memakai entri YAML                                                |
| Discovery             | PARTIAL | Skill catalog resolver (bundled/community/team/private); MCP dari YAML                           |
| Installation          | PARTIAL | Skill: dir/git/url/bundled; MCP: entri YAML                                                      |
| Dependency resolution | MISSING | Skill `skill:<slug>` diresolusi saat runtime, tanpa versi                                        |
| Activation            | PARTIAL | MCP `enabled`; skill aktif via agent/trigger/goal                                                |
| Deactivation          | PARTIAL | MCP `enabled: false`/remove; skill hapus file                                                    |
| Update                | PARTIAL | `SkillInstaller.upgrade` (versi manifest, overwrite)                                             |
| Uninstall             | PARTIAL | `SkillInstaller.remove`; `integrationRegistry.remove`                                            |
| Versioning            | PARTIAL | Skill `version`; MCP tidak                                                                       |
| Configuration         | PARTIAL | MCP `env`/`headers`/`args`; skill tidak                                                          |
| Permissions           | MISSING | Skill `permissions` tidak ditegakkan (P2-SKL-02); MCP hanya `allowedTools` + first-call approval |
| Isolation             | MISSING | MCP stdio & hook script mewarisi `process.env`; tanpa sandbox                                    |
| Lifecycle hooks       | MISSING | —                                                                                                |
| Error handling        | PARTIAL | MCP: invalidate & restart (maks 3) + fallback stub; hook: per handler                            |

## 3. Mengapa ini penting

Arsitektur Anvio sudah **port-based** (`ModelProvider`, `RuntimeToolPort`, `ChannelAdapter`, `MemoryProvider`, `AgentRuntime`), sehingga titik ekstensi teknisnya ada. Yang hilang adalah **lapisan kepercayaan dan lifecycle** di atasnya: siapa boleh mendaftarkan implementasi port, dari mana kodenya datang, izin apa yang dimilikinya, dan bagaimana ia diaktifkan/dimatikan tanpa mengubah `platform/src/index.ts`.

Saat ini menambah channel, provider (non-OpenAI-compatible), runtime, atau tool built-in **mewajibkan perubahan kode di repo dan rebuild**.

## 4. Perbandingan referensi

| Aspek          | Anvio                                                                                     | Hermes Agent (`67491b50f7e5`)                                                                              | OpenClaw (`163776f2b7e6`)                                                             | Orca (`22a95c4efe7e`)                                        |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Plugin manager | —                                                                                         | `hermes plugins install/enable/disable/list`                                                               | `openclaw plugins search/install/enable/disable/update/uninstall/inspect/reload`      | Repo memiliki `examples/plugins`; model plugin tidak diaudit |
| Manifest       | —                                                                                         | `plugin.yaml` + `register(ctx)`                                                                            | `openclaw.plugin.json` + `openclaw.compat.pluginApi`, `install.minHostVersion`        | —                                                            |
| Sumber         | —                                                                                         | direktori, katalog, `owner/repo`, git (SHA 40 char untuk pin), pip entry points                            | ClawHub (default), npm, git, path lokal, marketplace; sumber arbitrer butuh `--force` | —                                                            |
| Default        | —                                                                                         | plugin umum **off** sampai di-enable                                                                       | workspace-origin off; `plugins.allow`/`deny`                                          | —                                                            |
| Scan           | —                                                                                         | scan saat install: safe/caution/dangerous; dangerous memblokir                                             | `security.installPolicy` (perintah policy operator)                                   | —                                                            |
| Isolasi        | —                                                                                         | in-process default; opsional `plugins.isolation: host` (proses terpisah); "capabilities are not a sandbox" | in-process ("treat installs like running code")                                       | —                                                            |
| Hot reload     | —                                                                                         | aktif "on next session"                                                                                    | tanpa restart via gateway; `plugins reload <id>`                                      | —                                                            |
| Jenis          | tools, hooks, slash/CLI, skills, memory, context engine, model provider, terminal backend | channels, providers, tools, skills, hooks, services, gateway methods, voice/media                          | —                                                                                     |

Kedua referensi yang relevan memakai **plugin in-process yang tepercaya dengan gating konfigurasi**, bukan sandbox. Itu tradeoff yang dapat diterima bila didukung allow-list, pin versi, scan, dan default-off.
