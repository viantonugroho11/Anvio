# Security

## Default: No Authentication

Anvio runs with `auth.enabled: false` by default. Local tools work without login:

- Filesystem
- Local browser
- Local memory
- Local sessions

## Optional Auth Plugin

Enable only when required (MCP OAuth for GitHub, Google, Slack):

```yaml
spec:
  auth:
    enabled: true
    provider: oauth2
```

Providers: `none` (default), `jwt`, `oauth2`

## RBAC (Level 3+)

Role-based access when multi-user PostgreSQL deployment is enabled.

## Audit

Tool execution audit logs stored in `workspace/` (filesystem) or PostgreSQL (Level 3).

## Secrets

Environment variables for API keys. Vault/SSM for Level 4.
