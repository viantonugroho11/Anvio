# Remote Runtimes (Phase I)

Extended `@anvio/runtimes` providers:

| ID | Provider | Status |
|----|----------|--------|
| `ssh` | `SshRuntimeProvider` | Connectivity test + mock mode |
| `daytona` | `DaytonaRuntimeProvider` | Stub — requires `DAYTONA_API_KEY` |
| `modal` | `ModalRuntimeProvider` | Stub — requires `MODAL_TOKEN_ID/SECRET` |

## SSH Test

```bash
ANVIO_SSH_MOCK=1 anvio runtime test ssh   # CI/local mock (echo remote-ok)
anvio runtime test ssh                     # real SSH when ANVIO_SSH_HOST set
```

Agent streaming on SSH is deferred — use for remote shell connectivity checks first.

## Configuration

```yaml
# workspace anvio.yaml — future binding
spec:
  runtime:
    default: local
```

Environment: `ANVIO_SSH_HOST`, `ANVIO_SSH_USER`, `ANVIO_SSH_PORT`, `DAYTONA_API_KEY`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`.
