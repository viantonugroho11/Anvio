# Tool Gateway (Phase H)

Built-in tools without external MCP setup.

## Default Tools

| Tool | Name | Default |
|------|------|---------|
| Web fetch | `anvio_tools__web_fetch` | enabled |
| Web search | `anvio_tools__web_search` | disabled (needs `WEB_SEARCH_API_KEY`) |
| Execute code | `anvio_tools__execute_code` | disabled |

## Configuration

`workspace/tools/gateway.yaml`:

```yaml
apiVersion: anvio.io/v1
kind: ToolGateway
metadata:
  name: default
spec:
  enabled: true
  tools:
    web_fetch:
      enabled: true
    web_search:
      enabled: true
  webSearch:
    provider: brave
    apiKeyEnv: WEB_SEARCH_API_KEY
```

## CLI

```bash
anvio tools list
anvio tools test anvio_tools__web_fetch https://example.com
```

## Package

`@anvio/tools` — `ToolGateway` class + builtin executors.

## Related

- [38-integration-architecture.md](./38-integration-architecture.md) — external MCP
- [43-learning-loop.md](./43-learning-loop.md)
