# ADR 0034: Remote Tool Execution on the User's Machine over a Tailnet

## Status

Proposed

## Context

slaude's `/remote` points a thread at the user's own machine: from the next message, shell and file tools (Bash, Read, Write, Edit, Glob, Grep) run there, while the conversation, model credentials, MCP credentials, knowledge base and transcript stay on the server. Connectivity is [tailcat](https://github.com/tailscale/tailcat) plus an ed25519 key pair generated per workspace and user; the private key never leaves the server. Transport failures carry a `started` flag so a command that may already have run is never retried automatically. It is off by default (`SLAUDE_REMOTE=1`).

Anvio today:

- `packages/runtimes/src/ssh/ssh-runtime.ts` (`SshRuntimeProvider`) advertises `supportsTools: false` and only runs a single command over `ssh`; it cannot host an agent tool loop.
- `packages/runtimes/src/remote/remote-runtime-stub.ts` is a stub.
- Tool execution lives in `packages/tools` / `packages/execution`, always on the gateway host.

The useful split is not "run the whole runtime remotely" but "run the model loop locally, run file/shell tools remotely".

## Decision

Introduce remote tool execution as a **tool-execution target**, not a new runtime:

1. **`ExecTarget` port** in `packages/core`: `exec(cmd, { stdin, timeoutMs, login, maxOutput })` returning `{ stdout, stderr, code, truncated, timedOut }`, plus file read/write/list. The default target is local; `packages/tools` file and shell tools call the port instead of `node:child_process` / `fs` directly.
2. **`TailnetSshTarget`** in `packages/runtimes/src/remote/` implementing the port over SSH to a tailnet address (tailcat or plain Tailscale SSH). Keys are ed25519, generated per `(workspace, user)` and stored through the encrypted connection broker (`workspace/connections/`, same as runtime OAuth in ADR 0009). Only the public key is ever shown.
3. **Error semantics.** Transport errors are typed (`REMOTE_UNREACHABLE`, `REMOTE_AUTH_FAILED`) with a `started` flag; the tool gateway never auto-retries a started command.
4. **Binding.** A harness slash command `/remote <addr> <dir>` / `/remote off` binds the target per session; `/remote key` returns the public key privately. Binding is stored with the session, so resume keeps it.
5. **Off by default.** Requires `execution.remote.enabled: true` in `anvio.yaml`; remote targets are always subject to the harness approval policy for mutating tools.

`SshRuntimeProvider` is left as-is (single-shot command runtime) and documented as distinct from remote tool execution.

## Consequences

- Credentials, model keys and memory never leave the Anvio host; only tool I/O crosses the tailnet.
- Refactoring tools onto `ExecTarget` is the main cost and also benefits the sandboxed `execution` package (one seam instead of several).
- Works with every runtime that uses Anvio's tool gateway (`local`, and vendor runtimes only where Anvio tools are bridged); vendor CLIs with their own built-in shell tools (e.g. Claude Code's) are unaffected and must have those tools disabled when a remote target is bound.
- Adds Tailscale/tailcat as an optional user-side prerequisite; nothing changes at Level 1 when disabled.

## Alternatives considered

- **Extend `SshRuntimeProvider` to run the full agent remotely.** Rejected: would move model credentials and memory to the user's machine.
- **Reverse tunnel initiated by the user's machine.** Deferred: avoids exposing SSH but needs a long-lived agent process on the user side.
