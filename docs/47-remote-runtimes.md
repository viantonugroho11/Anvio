# Remote Runtimes (Phase I / P13)

Extended `@anvio/runtimes` providers:

| ID | Provider | Status |
|----|----------|--------|
| `ssh` | `SshRuntimeProvider` | Connectivity test + `execRemote` |
| `daytona` | `DaytonaRuntimeProvider` | Mock + HTTP exec when `DAYTONA_API_KEY` set |
| `modal` | `ModalRuntimeProvider` | Mock + HTTP exec when `MODAL_TOKEN_*` set |
| `singularity` | `SingularityRuntimeProvider` | Mock + local `singularity exec` when `SINGULARITY_IMAGE` set |

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

## Singularity / Apptainer exec

Unlike Daytona/Modal (remote HTTP APIs), Singularity is a **local** HPC container
runtime — Anvio shells out to the `singularity`/`apptainer` binary directly
(no cloud API), the same way `DockerRuntimeProvider` shells out to `docker`.

```bash
ANVIO_SINGULARITY_MOCK=1 anvio runtime exec singularity -- echo ok

# Real usage: point at a SIF image or docker:// URI
export SINGULARITY_IMAGE=docker://ubuntu
anvio runtime exec singularity -- uname -a
anvio runtime test singularity
```

Agent streaming on SSH/Singularity is deferred — use `execRemote` for remote/container shell commands.

## Configuration

Environment: `ANVIO_SSH_HOST`, `ANVIO_SSH_USER`, `ANVIO_SSH_PORT`, `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_API_URL`, `SINGULARITY_BINARY` (default `singularity`), `SINGULARITY_IMAGE`.
