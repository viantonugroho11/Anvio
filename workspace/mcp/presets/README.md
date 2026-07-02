# MCP integration presets (P11d)

Copy snippets into `workspace/mcp/servers.yaml` and enable servers as needed.

| Preset | Hermes tools covered |
|--------|---------------------|
| `homeassistant.yaml.example` | Optional MCP wrapper; built-in `ha_*` gateway tools use REST |
| `spotify.yaml.example` | `spotify_*` via MCP; gateway `spotify_search` delegates here |
| `feishu.yaml.example` | `feishu_*` via MCP; gateway `feishu_doc_read` delegates here |
| `tinker-atropos.yaml.example` | `rl_*` via MCP; gateway `rl_tool` delegates here |
| `yuanbao.yaml.example` | `yb_*` via MCP; gateway `yb_tool` delegates here |
| `video-gen.yaml.example` | video generation via MCP; gateway `video_generate` delegates here |
| `honcho.yaml.example` | `honcho_*` via MCP; gateway `honcho_tool` delegates here |

Built-in gateway tools (no MCP required): `ha_*`, `x_search`, `mixture_of_agents`, `video_analyze` (ffmpeg + vision), `discord_admin`, `skill_manage`.
