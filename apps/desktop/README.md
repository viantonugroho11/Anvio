# Anvio Desktop (P14 scaffold)

**Status:** deferred — CLI remains primary surface.

Planned shell:

- Tray icon + quick prompt
- Wraps `anvio chat` / `anvio session 1on1`
- Workspace picker from `ANVIO_WORKSPACE`

## Build (future)

```bash
# Tauri or Electron — not yet wired
pnpm --filter @anvio/desktop dev
```

## Env

| Variable | Purpose |
|----------|---------|
| `ANVIO_WORKSPACE` | Workspace root |
| `ANVIO_DESKTOP_TRAY` | Enable tray mode |

See [75-phase-p14-priorities.md](../../docs/75-phase-p14-priorities.md).
