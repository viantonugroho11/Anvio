# Katalog Tools Hermes → Mapping Anvio

**Referensi Hermes:** [Built-in Tools Reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) · [Toolsets Reference](https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference)  
**Anvio gateway:** `workspace/tools/gateway.yaml` · `@anvio/tools` · prefix `anvio_tools__*`  
**Status Anvio:** v1.16.0+ (P11b) — **42 built-in gateway tools** + MCP `anvio_mcp__*` + harness channel tools

Hermes registry saat ini: **~71 built-in tools** (core + plugin-registered), ditambah **MCP dynamic** (`mcp_{server}_{tool}`). Anvio menutup gap lewat gateway built-in, MCP bridge, harness, dan modul Agent OS terpisah (kanban, cron, delegation, dll.).

---

## Legenda mapping

| Simbol | Arti |
|--------|------|
| ✅ | Parity langsung di Anvio gateway atau modul setara |
| 🟡 | Partial / nama berbeda / subset capability |
| MCP | Via MCP server (`anvio mcp`, bukan built-in gateway) |
| OS | Bukan tool gateway — fitur Agent OS (CLI/modul) |
| ❌ | Belum ada |

---

## 1. Anvio built-in gateway (42 tools)

### Core web & file (Hermes `web`, `file`, `search`)

| Anvio key | Hermes setara | Status |
|-----------|---------------|--------|
| `web_fetch`, `web_search`, `web_extract`, `http_request` | `web_search`, `web_extract` | ✅ |
| `file_read`, `file_write`, `edit_file`, `patch_file`, `append_file`, `file_delete` | `read_file`, `write_file`, `patch` | ✅/🟡 |
| `glob_files`, `grep_search`, `search_files`, `list_dir`, `path_exists` | `search_files` | ✅ |

### Terminal & code (Hermes `terminal`, `code_execution`)

| Anvio key | Hermes setara | Status |
|-----------|---------------|--------|
| `run_shell`, `terminal`, `process` | `terminal`, `process` | 🟡 |
| `execute_code`, `execute_code_pipeline` | `execute_code` | 🟡 |

### Browser (Hermes `browser` toolset)

| Anvio key | Hermes setara | Status |
|-----------|---------------|--------|
| `browser` (legacy) | composite | 🟡 |
| `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type` | same | ✅ |
| `browser_scroll`, `browser_back`, `browser_press`, `browser_console` | same | ✅ |
| `browser_cdp`, `browser_dialog`, `browser_vision`, `browser_get_images` | — | ❌ |

### Media & vision

| Anvio key | Hermes setara | Status |
|-----------|---------------|--------|
| `image_generate`, `text_to_speech`, `vision_analyze` | same | ✅/🟡 |

### Agent orchestration

| Anvio key | Hermes setara | Status |
|-----------|---------------|--------|
| `todo`, `clarify`, `session_search` | same | ✅ |
| `memory_recall` | `memory` | 🟡 |
| `kanban_list`, `kanban_show`, `kanban_create`, `kanban_move` | `kanban_*` subset | 🟡 |

### Utility

| Anvio key | Hermes setara |
|-----------|---------------|
| `json_parse`, `datetime_now` | — |

### Full key list (previous P11a table retained below for defaults)

## 2. Hermes core toolsets (semua tools)

### `web` · `search`

| Hermes tool | Deskripsi singkat | Anvio |
|-------------|-------------------|-------|
| `web_search` | Search web (Brave/Tavily/Parallel/Exa/Firecrawl) | ✅ `web_search` |
| `web_extract` | Extract URL → markdown | 🟡 `web_fetch` |

### `file`

| Hermes tool | Deskripsi singkat | Anvio |
|-------------|-------------------|-------|
| `read_file` | Read dengan line numbers + pagination | ✅ `file_read` |
| `write_file` | Overwrite file penuh | ✅ `file_write` |
| `patch` | Fuzzy find-replace + diff | 🟡 `edit_file` |
| `search_files` | Ripgrep + find by name | 🟡 `grep_search` + `glob_files` |

### `terminal`

| Hermes tool | Deskripsi singkat | Anvio |
|-------------|-------------------|-------|
| `terminal` | Shell command execution | 🟡 `run_shell` / OS `anvio exec` |
| `process` | Background process poll/kill/log | ❌ |

### `browser` (10 core + 2 CDP-gated)

| Hermes tool | Anvio |
|-------------|-------|
| `browser_navigate` | 🟡 `browser` (action: navigate) |
| `browser_snapshot` | 🟡 `browser` (action: content) |
| `browser_click` | ❌ |
| `browser_type` | ❌ |
| `browser_scroll` | ❌ |
| `browser_back` | ❌ |
| `browser_press` | ❌ |
| `browser_console` | ❌ |
| `browser_get_images` | ❌ |
| `browser_vision` | ❌ |
| `browser_cdp` | ❌ (slaude CDP grant 🟡 partial) |
| `browser_dialog` | ❌ |
| `web_search` (bundled) | ✅ `web_search` |

### `vision` · `image_gen` · `video` · `video_gen` · `tts`

| Hermes tool | Anvio |
|-------------|-------|
| `vision_analyze` | ❌ (planned: vision tool) |
| `image_generate` | ✅ `image_generate` |
| `video_analyze` | ❌ |
| `video_generate` | ❌ |
| `text_to_speech` | ✅ `text_to_speech` |

### `code_execution`

| Hermes tool | Anvio |
|-------------|-------|
| `execute_code` | 🟡 `execute_code` (Python RPC di Hermes; Anvio JS/sandbox + pipeline) |

### `memory` · `session_search` · Honcho plugin

| Hermes tool | Anvio |
|-------------|-------|
| `memory` | 🟡 `memory_recall` + `@anvio/memory` |
| `session_search` | OS `anvio sessions` / workspace sessions 🟡 |
| `honcho_context` | ✅ Honcho provider `@anvio/memory` |
| `honcho_profile` | ✅ Honcho provider |
| `honcho_search` | ✅ Honcho provider |
| `honcho_conclude` | ✅ Honcho provider |

### `skills`

| Hermes tool | Anvio |
|-------------|-------|
| `skills_list` | OS `anvio skill catalog` |
| `skill_view` | OS `anvio skill validate` / workspace skills |
| `skill_manage` | OS `anvio learning promote` + skill drafts |

### `todo` · `clarify`

| Hermes tool | Anvio |
|-------------|-------|
| `todo` | ❌ (in-session todo list) |
| `clarify` | ❌ (harness approval partial 🟡) |

### `delegation`

| Hermes tool | Anvio |
|-------------|-------|
| `delegate_task` | OS `@anvio/agents` subagent delegation ✅ |

### `cronjob`

| Hermes tool | Anvio |
|-------------|-------|
| `cronjob` | OS `anvio automation` + `anvio cron` ✅ |

### `messaging`

| Hermes tool | Anvio |
|-------------|-------|
| `send_message` | Harness `anvio_channel__reply` + ChannelHub ✅ |

### `moa`

| Hermes tool | Anvio |
|-------------|-------|
| `mixture_of_agents` | ❌ |

### `x_search`

| Hermes tool | Anvio |
|-------------|-------|
| `x_search` | ❌ (xAI gated) |

### `computer_use`

| Hermes tool | Anvio |
|-------------|-------|
| `computer_use` | ❌ (macOS cua-driver) |

### `homeassistant`

| Hermes tool | Anvio |
|-------------|-------|
| `ha_list_entities` | MCP / ❌ |
| `ha_get_state` | MCP / ❌ |
| `ha_list_services` | MCP / ❌ |
| `ha_call_service` | MCP / ❌ |

### `kanban` (9 tools)

| Hermes tool | Anvio |
|-------------|-------|
| `kanban_show` | OS `anvio kanban` 🟡 |
| `kanban_list` | OS `anvio kanban list` |
| `kanban_create` | OS `anvio kanban create` |
| `kanban_complete` | OS `anvio kanban move` 🟡 |
| `kanban_block` | ❌ |
| `kanban_unblock` | ❌ |
| `kanban_heartbeat` | ❌ |
| `kanban_comment` | ❌ |
| `kanban_link` | ❌ |

### `rl` (Tinker-Atropos)

| Hermes tool | Anvio |
|-------------|-------|
| `rl_list_environments` | ❌ |
| `rl_select_environment` | ❌ |
| `rl_get_current_config` | ❌ |
| `rl_edit_config` | ❌ |
| `rl_start_training` | ❌ |
| `rl_check_status` | ❌ |
| `rl_stop_training` | ❌ |
| `rl_get_results` | ❌ |
| `rl_list_runs` | ❌ |
| `rl_test_inference` | ❌ |

### `feishu_doc` · `feishu_drive`

| Hermes tool | Anvio |
|-------------|-------|
| `feishu_doc_read` | ❌ |
| `feishu_drive_add_comment` | ❌ |
| `feishu_drive_list_comments` | ❌ |
| `feishu_drive_list_comment_replies` | ❌ |
| `feishu_drive_reply_comment` | ❌ |

### `discord` · `discord_admin`

| Hermes tool | Anvio |
|-------------|-------|
| `discord` | Channel adapter 🟡 (bukan agent tool) |
| `discord_admin` | ❌ |

### `spotify` (plugin)

| Hermes tool | Anvio |
|-------------|-------|
| `spotify_playback` | MCP / ❌ |
| `spotify_devices` | MCP / ❌ |
| `spotify_queue` | MCP / ❌ |
| `spotify_search` | MCP / ❌ |
| `spotify_playlists` | MCP / ❌ |
| `spotify_albums` | MCP / ❌ |
| `spotify_library` | MCP / ❌ |

### `yuanbao` (hermes-yuanbao)

| Hermes tool | Anvio |
|-------------|-------|
| `yb_query_group_info` | ❌ |
| `yb_query_group_members` | ❌ |
| `yb_send_dm` | ❌ |
| `yb_search_sticker` | ❌ |
| `yb_send_sticker` | ❌ |

---

## 3. Hermes platform toolsets (presets)

Platform presets menentukan bundle tools per deployment. Anvio setara via harness profiles + channel config.

| Hermes preset | Isi | Anvio setara |
|---------------|-----|--------------|
| `hermes-cli` | Full interactive CLI | CLI + gateway.yaml defaults |
| `hermes-acp` | Coding-focused, no messaging/TTS | `anvio acp serve` + Cursor runtime |
| `hermes-api-server` | Programmatic, no clarify/messaging | `anvio/api` REST |
| `hermes-telegram` | Full + approval | Telegram adapter + harness |
| `hermes-discord` | + discord, discord_admin | Discord adapter |
| `hermes-slack` | Full | Slack adapter |
| `hermes-whatsapp` | Full | WhatsApp adapter |
| `hermes-signal` | Full | Signal stub 🟡 |
| `hermes-matrix` | Full | Matrix webhook ✅ |
| `hermes-email` | Full | Email IMAP/SMTP ✅ |
| `hermes-homeassistant` | Full + ha_* | ❌ |
| `hermes-gateway` | Union all platforms | `@anvio/channels` ChannelHub |
| `hermes-feishu` | + feishu_* | ❌ |
| `hermes-yuanbao` | + yb_* | ❌ |

Composite Hermes:

| Preset | Includes | Anvio |
|--------|----------|-------|
| `debugging` | file + terminal + web | gateway subset 🟡 |
| `safe` | web + vision + image_gen (read-only) | partial 🟡 |

Wildcard: `all` / `*` → semua toolset (+ MCP + plugin). Anvio: enable per-tool di `gateway.yaml` + MCP servers.

---

## 4. MCP & plugin tools (Hermes)

Hermes:

- Setiap MCP server → toolset `mcp-{name}` (e.g. `mcp-github`)
- Plugin → `ctx.register_tool()` (Spotify, video_gen, Honcho memory, dll.)

Anvio:

- MCP → `anvio_mcp__{server}__{tool}` via `@anvio/integrations`
- First-call approval gate per session (P7)
- `anvio mcp list|test|health`

Contoh MCP umum (keduanya): GitHub, filesystem, postgres, brave-search, puppeteer, dll.

---

## 5. Ringkasan coverage (v1.16.0)

| Kategori Hermes | Jumlah tool (approx) | Anvio gateway | Anvio OS/MCP |
|-----------------|----------------------|---------------|--------------|
| Web | 2 | 3 ✅ | — |
| File | 4 | 8 ✅/🟡 | — |
| Terminal | 2 | 1 🟡 | `anvio exec` |
| Browser | 12 | 1 🟡 | — |
| Media (vision/image/video/tts) | 5 | 2 ✅ | voice CLI |
| Code execution | 1 | 2 🟡 | execution sandbox |
| Memory / session | 2 + Honcho | 1 🟡 | memory, sessions |
| Skills | 3 | — | skill CLI ✅ |
| Planning | todo, clarify | — | planner CLI ✅ |
| Delegation | 1 | — | agents ✅ |
| Automation | cronjob | — | automation ✅ |
| Messaging | send_message | — | harness ✅ |
| Kanban | 9 | — | kanban partial 🟡 |
| RL | 10 | — | ❌ |
| Home Assistant | 4 | — | MCP/❌ |
| Integrations (Feishu, Discord admin, Spotify, Yuanbao) | 18+ | — | mostly ❌ |
| MoA, x_search, computer_use | 3 | — | ❌ |

**Gateway parity (breadth):** ~42 / ~71 built-in Hermes tools ≈ **59%** by count; **~75%** core dev workflow with MCP.

---

## 6. Prioritas expand T1 (Anvio P11b+)

Urutan ROI untuk mendekati Hermes `hermes-cli`:

1. `process` — background shell management
2. `browser_click` / `browser_type` / `browser_snapshot` — full Playwright parity
3. `vision_analyze` — multimodal tool
4. `todo` — in-session task list tool
5. `clarify` — structured user question tool
6. `session_search` — FTS over session DB as agent tool
7. `patch` — upgrade `edit_file` to fuzzy match (Hermes-style)
8. `web_extract` — alias atau enhance `web_fetch` dengan markdown extract
9. Kanban agent tools (`kanban_*`) — wire `@anvio/kanban` ke gateway
10. Platform-specific (Feishu, Spotify, HA) — via MCP first

---

## Dokumen terkait

- [44-tool-gateway.md](./44-tool-gateway.md) — konfigurasi Anvio gateway
- [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) — gap register T1
- [64-phase-p11a-priorities.md](./64-phase-p11a-priorities.md) — P11a shipped
- [Hermes Tools Reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) — sumber otoritatif upstream

Terakhir diperbarui: v1.16.0 (2026-06-19).
