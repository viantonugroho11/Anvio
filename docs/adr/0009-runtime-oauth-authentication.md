# ADR 0009: Runtime OAuth Authentication (Vendor-Native Agents)

## Status

Accepted

## Context

Anvio supports multiple **runtime providers** (`local`, `claude-code`, `cursor`, `codex`, future `antigravity`) in addition to direct **model providers** (`anthropic`, `openai`, …).

Today, Claude is accessed primarily via `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`. External runtimes (`claude-code`, `cursor`, `codex`) were stubs. Product direction requires:

- **Vendor-native runtimes** authenticate through the official app/CLI OAuth or session (Pro/Max subscription), not Anvio-managed API keys.
- **`local` runtime** continues to use API keys / credential pools for direct provider access and fallback.
- Future parity targets: Cursor (ACP + app session), OpenAI Codex CLI, Google Antigravity CLI.

Anthropic policy note: third-party products must not host claude.ai login UI or resell subscription rate limits. Anvio therefore **delegates login to the official Claude Code CLI** (`claude setup-token`) and only stores the resulting token locally (encrypted connection broker).

## Decision

Adopt a **two-layer auth model**:

| Layer | Auth mechanism | When used |
|-------|----------------|-----------|
| **Runtime provider** | OAuth token / app session via official vendor tooling | `agent.spec.runtime.provider` ∈ `{ claude-code, cursor, codex, antigravity }` |
| **Model provider** | API key / credential pool | `local` runtime (default) and explicit model routing |

### Claude Code (implemented)

1. Use `@anthropic-ai/claude-agent-sdk` inside `ClaudeCodeRuntimeProvider`.
2. Resolve auth in order:
   - Encrypted connection broker payload (`service: claude-code`)
   - `CLAUDE_CODE_OAUTH_TOKEN` environment variable
   - Interactive CLI cache (SDK fallback when neither is set and user already ran `claude login`)
3. **Never pass `ANTHROPIC_API_KEY`** into the Agent SDK subprocess env when OAuth mode is active — API key shadows OAuth and bills API credits instead of subscription quota.
4. User onboarding:
   ```bash
   anvio setup-token --claude    # wraps official `claude setup-token`
   anvio setup-token --cursor    # wraps official `agent login`
   anvio setup-token --codex     # wraps official `codex login`
   anvio setup-token --list      # show supported vendors
   ```
   Legacy alias: `anvio connect login claude-code` → `anvio setup-token --claude`.
5. Agent binding:
   ```yaml
   spec:
     runtime:
       provider: claude-code
       fallback: local
     model:
       provider: anthropic   # used only when fallback: local
       model: claude-sonnet-4-20250514
   ```

### Cursor (planned — partial today)

- Auth via **Cursor desktop app session**, not `CURSOR_API_KEY`.
- Anvio delegates through `anvio acp serve` → `CursorRuntimeProvider`.
- No Anvio-hosted OAuth UI.

### Codex (partial today)

- Auth via **OpenAI Codex CLI** (`codex login`) → `~/.codex/auth.json`.
- `anvio setup-token --codex` wraps official login.

### Antigravity (partial today)

- Official **[Antigravity CLI](https://github.com/google-antigravity/antigravity-cli)** (`agy`) — Google Sign-In via system keyring; local browser or SSH authorization URL.
- Install: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
- `anvio setup-token --antigravity` wraps `agy auth login` (falls back to first `-p` prompt).
- Headless/CI: pass `--token` (`ANTIGRAVITY_TOKEN`) after completing Google Sign-In elsewhere.
- **Not** `GEMINI_API_KEY` — Antigravity runtime uses Google account OAuth, not Gemini API billing.
- `AntigravityRuntimeProvider` wiring pending; setup-token + broker storage implemented.

### Platform routing

`RuntimeRoutingAgentRuntime` selects external runtime when configured; otherwise `DefaultAgentRuntime` (model provider + tool loop).

### Runtime fallback (cross-vendor)

Fallback is **runtime → runtime**, one hop, triggered when the primary runtime is **not configured** (`isConfigured()`), not on mid-run auth errors.

Allowed values today: `local`, `cursor`, `claude-code`, `codex` (`antigravity` setup-token ✅; runtime provider pending).

```yaml
# Claude primary, Cursor secondary, API key only if both missing
spec:
  runtime:
    provider: claude-code
    fallback: cursor
  model:
    provider: anthropic   # used only when fallback reaches `local`
    model: claude-sonnet-4-20250514
```

Chain fallback (`A → B → C`) and failure-time fallback (token expired mid-run) are **not** implemented yet.

### Per-agent and per-user runtime

| Scope | Mechanism | Example |
|-------|-----------|---------|
| **Per agent** | `agent.spec.runtime` in agent YAML/MD | `architect` → claude-code, `coder` → codex |
| **Per user** | Connection broker key `channel:userId:service` | Alice OAuth Claude, Bob OAuth Codex |

```bash
# Multi-user OAuth on one workspace
export ANVIO_CONNECTION_ENCRYPTION_KEY=your-secret
anvio setup-token --claude --user alice
anvio setup-token --codex  --user bob
```

Agent-to-agent collaboration uses orchestration (`delegate_task`, supervisor pattern, `mixture_of_agents`, workflows) — not a shared chat thread by default.

### Docker, server, and headless OAuth

Vendor OAuth flows expect a **browser**. Headless servers and containers should **not** run interactive login inside the container on first boot.

#### Pattern 1 — Provision offline, mount workspace (recommended)

Run login on a machine with a browser, then ship encrypted broker state to the server.

```bash
# On laptop / bastion (has browser)
export ANVIO_CONNECTION_ENCRYPTION_KEY="${ANVIO_CONNECTION_ENCRYPTION_KEY}"
anvio setup-token --claude --user alice
anvio setup-token --codex  --user bob

# Copy to server (includes workspace/connections/_state/*.json)
rsync -av ./workspace/connections/ user@server:/opt/anvio/workspace/connections/
```

`docker-compose` worker/gateway snippet:

```yaml
services:
  worker:
    environment:
      ANVIO_WORKSPACE: /workspace
      ANVIO_CONNECTION_ENCRYPTION_KEY: ${ANVIO_CONNECTION_ENCRYPTION_KEY}
      # Optional global fallback when broker miss:
      # CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN}
    volumes:
      - ./workspace:/workspace
    # Do NOT bake tokens into the image layer
```

Enable broker in `workspace/harness/defaults.yaml`:

```yaml
connectBroker:
  enabled: true
  encryptionKeyEnv: ANVIO_CONNECTION_ENCRYPTION_KEY
```

#### Pattern 2 — Environment variables (single-tenant)

Inject tokens via secrets manager / `.env` (never commit):

```yaml
environment:
  CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN}
  CODEX_ACCESS_TOKEN: ${CODEX_ACCESS_TOKEN}   # optional Codex path
```

Platform resolves Claude OAuth from env when broker is disabled or empty.

#### Pattern 3 — Headless vendor CLI

| Vendor | Headless command | Notes |
|--------|------------------|-------|
| **Codex** | `codex login --device-auth` | Open device URL on another machine |
| **Cursor** | `NO_OPEN_BROWSER=1 agent login` | Paste URL manually |
| **Claude Code** | `claude setup-token` on bastion | Copy token → Pattern 1 or 2 |

After Codex device login, copy `~/.codex/auth.json` or run `anvio setup-token --codex --user bob` on the bastion.

#### Pattern 4 — `local` runtime + API key (simplest for Docker)

Existing production compose uses API keys for `local` fallback:

```yaml
environment:
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

Agents with `runtime.fallback: local` work without vendor OAuth. Use when subscription OAuth is not required in the container.

#### Pattern 5 — Mount vendor credential dirs (dev/staging only)

```yaml
volumes:
  - ${HOME}/.codex:/root/.codex:ro
```

Weak isolation — acceptable for single-developer staging, not recommended for multi-tenant production.

#### Multi-user in Docker

Map channel `userId` to broker entries provisioned offline:

| User | setup-token | Agent example |
|------|-------------|---------------|
| `alice` | `--claude --user alice` | `architect` (claude-code) |
| `bob` | `--codex --user bob` | `coder` (codex) |

Sessions must use matching `userId` (auth plugin or `defaultUserId` override per channel). Each user gets isolated OAuth from broker; same agent definition can serve both if runtime resolves per user token.

#### Security checklist

- Never commit `ANVIO_CONNECTION_ENCRYPTION_KEY` or OAuth tokens to git.
- Rotate encryption key only with a migration plan (existing blobs become unreadable).
- Prefer secrets manager (Vault, K8s Secret, Docker Secret) over plain `.env` in production.
- Do not run `anvio setup-token` in CI without a dedicated service account token path.


- Claude Code agents can run on **Pro/Max subscription quota** without `ANTHROPIC_API_KEY`.
- `local` fallback still requires API keys — unchanged Level-1 behavior.
- Connection broker stores runtime OAuth tokens separately from MCP/channel tokens (`service` discriminator).
- Compliance: login UX stays on vendor CLI; Anvio stores tokens locally only.

## Alternatives Rejected

- **Custom claude.ai OAuth UI in Anvio** — violates Anthropic third-party policy; rejected.
- **Single API-key path for all runtimes** — double billing risk; doesn't use subscription quota.
- **Hard-require API key on every agent** — blocks vendor-native runtime goal.

## References

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk)
- [docs/30-runtime-providers.md](../30-runtime-providers.md)
- [docs/33-credential-pools.md](../33-credential-pools.md) — API keys for `local` runtime only
