# Tool Gateway (Phase H → P11b)

Built-in tools without external MCP setup. Prefix runtime: `anvio_tools__*`.

**Katalog Hermes lengkap (~71 tools) + mapping:** [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md)

## Anvio gateway tools (42)

### Web & file
`web_fetch`, `web_search`, `web_extract`, `http_request`, `file_read`, `file_write`, `edit_file`, `patch_file`, `append_file`, `file_delete`, `glob_files`, `grep_search`, `search_files`, `list_dir`, `path_exists`

### Terminal & code
`run_shell`, `terminal`, `process`, `execute_code`, `execute_code_pipeline`

### Browser (Playwright session)
`browser` (legacy), `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_console`

### Media & vision
`image_generate`, `text_to_speech`, `vision_analyze`

### Agent orchestration
`todo`, `clarify`, `session_search`, `memory_recall`, `kanban_list`, `kanban_show`, `kanban_create`, `kanban_move`

### Utility
`json_parse`, `datetime_now`

Enable write/exec/browser/kanban tools in `workspace/tools/gateway.yaml` when needed.

## Configuration

`workspace/tools/gateway.yaml` — see defaults in `@anvio/tools` `DEFAULT_TOOL_GATEWAY_YAML`.

## CLI

```bash
anvio tools list
anvio tools test anvio_tools__web_extract https://example.com
anvio tools test anvio_tools__search_files '{"pattern":"tool","target":"content"}'
```

## MCP (Hermes `mcp-*` toolsets)

External tools via MCP — prefix `anvio_mcp__{server}__{tool}`:

```bash
anvio mcp list
anvio mcp health
```

## Package

`@anvio/tools` — `ToolGateway` + `buildModelToolDefinitions()` for native tool_use.

## Related

- [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) — full Hermes tool inventory
- [38-integration-architecture.md](./38-integration-architecture.md) — external MCP
- [43-learning-loop.md](./43-learning-loop.md)
