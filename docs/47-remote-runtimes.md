# Remote Runtimes (Phase I / P13)

Extended `@anvio/runtimes` providers:

| ID | Provider | Status |
|----|----------|--------|
| `ssh` | `SshRuntimeProvider` | Connectivity test + `execRemote` |
| `daytona` | `DaytonaRuntimeProvider` | Mock + HTTP exec when `DAYTONA_API_KEY` set |
| `modal` | `ModalRuntimeProvider` | Mock + HTTP exec when `MODAL_TOKEN_*` set |

## SSH exec

```bash
ANVIO_SSH_MOCK=1 anvio runtime exec ssh -- echo remote-ok
anvio runtime exec ssh -- uname -a   # when ANVIO_SSH_HOST set
```

## Daytona / Modal exec

```bash
ANVIO_DAYTONA_MOCK=1 anvio runtime exec daytona -- echo ok
ANVIO_MODAL_MOCK=1 anvio runtime exec modal -- echo ok
```

Agent streaming on SSH is deferred — use `execRemote` for remote shell commands.

## Configuration

Environment: `ANVIO_SSH_HOST`, `ANVIO_SSH_USER`, `ANVIO_SSH_PORT`, `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_API_URL`.
