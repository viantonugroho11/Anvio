# Memory Architecture

## Default: Filesystem (Level 1)

```
workspace/memory/
  sessions/{session-id}.json   # Short-term conversation context
  {user-id}.json               # Long-term facts and preferences
```

No Redis, PostgreSQL, or Qdrant required.

## Optional Providers (Progressive Enhancement)

| Provider | Level | Use Case |
|----------|-------|----------|
| filesystem | 1 | Solo developer, portable workspace |
| sqlite | 2 | Small team, single file DB |
| postgresql | 3 | Multi-user production |
| qdrant | 3 | Semantic/knowledge retrieval |
| redis | 3 | High-throughput session cache |

Configure in `workspace/anvio.yaml`:

```yaml
spec:
  memory:
    provider: filesystem
    basePath: memory
```

## Policies (Phase 2+)

- Memory ranking by recency and relevance
- Summarization when token budget exceeded
- Retention policies per memory type
