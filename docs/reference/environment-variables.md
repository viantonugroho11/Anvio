# Environment variables

Every variable below is read somewhere in `packages/` or `apps/` source. Defaults are the values in code when the variable is unset. For a copy-ready template see [`.env.example`](https://github.com/viantonugroho11/Anvio/blob/main/.env.example).

::: danger Model key vs runtime OAuth
Never set `ANTHROPIC_API_KEY` in the same environment as an agent using `runtime.provider: claude-code`. The variable shadows the OAuth login from `anvio setup-token --claude` and bills API credits instead of the subscription. See [ADR-0009](../adr/0009-runtime-oauth-authentication.md).
:::

## Core platform

| Variable                      | Description                                             | Required | Default                            | Example         |
| ----------------------------- | ------------------------------------------------------- | -------- | ---------------------------------- | --------------- |
| `ANVIO_WORKSPACE`             | Path to the workspace directory                         | No       | `<cwd>/workspace`                  | `~/my-agents`   |
| `ANVIO_LOG_LEVEL`             | pino log level                                          | No       | `info` in production, else `debug` | `warn`          |
| `ANVIO_SERVICE_NAME`          | `service` field on every log line                       | No       | `anvio`                            | `anvio-gateway` |
| `ANVIO_MAX_CONCURRENT_RUNS`   | Global cap on concurrent agent turns                    | No       | `8`                                | `4`             |
| `ANVIO_MAX_DELEGATION_DEPTH`  | Nesting limit for `delegate_task` / `mixture_of_agents` | No       | `3`                                | `2`             |
| `ANVIO_MAX_TOOL_OUTPUT_CHARS` | Tool output clipped before it is fed back to the model  | No       | `8000`                             | `16000`         |
| `ANVIO_MODEL_IDLE_TIMEOUT_MS` | Abort a model stream idle for this long (`0` disables)  | No       | `300000`                           | `120000`        |
| `ANVIO_PROMPT_CACHING`        | Set `false` to disable provider prompt caching          | No       | enabled                            | `false`         |

## Gateway and API

| Variable                   | Description                                                              | Required            | Default                 | Example                   |
| -------------------------- | ------------------------------------------------------------------------ | ------------------- | ----------------------- | ------------------------- |
| `ANVIO_GATEWAY_HOST`       | Bind address of `anvio gateway start`                                    | No                  | `127.0.0.1`             | `0.0.0.0`                 |
| `ANVIO_GATEWAY_PORT`       | Gateway port (HTTP + WebSocket)                                          | No                  | `3001`                  | `8080`                    |
| `API_HOST`                 | Bind address of the standalone NestJS API (`apps/api`)                   | No                  | `127.0.0.1`             | `0.0.0.0`                 |
| `API_PORT`                 | Port of the standalone API                                               | No                  | `3000`                  | `3000`                    |
| `ANVIO_API_CORS_ORIGINS`   | Extra comma-separated CORS origins (loopback origins are always allowed) | No                  | —                       | `https://app.example.com` |
| `ANVIO_API_ALLOW_INSECURE` | `true` lets the API bind a non-loopback host **without auth**. Avoid.    | No                  | `false`                 | `true`                    |
| `ANVIO_API_URL`            | API base URL used by the web dashboard                                   | No                  | `http://localhost:3000` | `http://api:3000`         |
| `ANVIO_API_TOKEN`          | Bearer token the dashboard sends to the API (server-side only)           | When API auth is on | —                       | —                         |
| `JWT_SECRET`               | JWT signing secret when `auth.enabled: true` (Level 3+)                  | When auth is on     | —                       | —                         |

## Secrets at rest

| Variable                          | Description                                               | Required             | Default |
| --------------------------------- | --------------------------------------------------------- | -------------------- | ------- |
| `ANVIO_CREDENTIALS_PASSPHRASE`    | Encrypts credential pools (`anvio credentials`)           | For credential pools | —       |
| `ANVIO_CONNECTION_ENCRYPTION_KEY` | Encrypts contextual connection payloads (`anvio connect`) | For connections      | —       |

## Model providers

Only the variable for the provider an agent uses is needed. Without any key, the `local` runtime answers with a mock provider.

| Provider                   | Variable(s)                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Anthropic                  | `ANTHROPIC_API_KEY`                                                                  |
| OpenAI                     | `OPENAI_API_KEY`                                                                     |
| Google Gemini              | `GEMINI_API_KEY` or `GOOGLE_API_KEY`                                                 |
| OpenRouter                 | `OPENROUTER_API_KEY` (optional `OPENROUTER_REFERER`, `OPENROUTER_APP_NAME`)          |
| DeepSeek                   | `DEEPSEEK_API_KEY`                                                                   |
| Groq · Mistral             | `GROQ_API_KEY` · `MISTRAL_API_KEY`                                                   |
| Together · xAI             | `TOGETHER_API_KEY` · `XAI_API_KEY`                                                   |
| Fireworks · Moonshot       | `FIREWORKS_API_KEY` · `MOONSHOT_API_KEY`                                             |
| Cerebras · SambaNova       | `CEREBRAS_API_KEY` · `SAMBANOVA_API_KEY`                                             |
| Perplexity · Cohere        | `PERPLEXITY_API_KEY` · `COHERE_API_KEY`                                              |
| Hugging Face               | `HF_TOKEN`                                                                           |
| Ollama                     | `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` (optional), `OLLAMA_ENABLED` / `OLLAMA_DISABLED` |
| OpenAI-compatible `custom` | `CUSTOM_OPENAI_API_KEY`                                                              |

## Tools and sandbox

| Variable                                                   | Description                                                            | Default          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `WEB_SEARCH_API_KEY`                                       | Key for `web_search` (provider set in `gateway.yaml`, default `brave`) | —                |
| `ANVIO_SANDBOX_ENV_PASSTHROUGH`                            | Comma-separated host variables the code sandbox may see                | none             |
| `ANVIO_DOCKER_IMAGE`                                       | Image for the `docker` runtime                                         | `node:20-alpine` |
| `ANVIO_SSH_HOST`, `ANVIO_SSH_PORT`, `ANVIO_SSH_USER`       | Target for the `ssh` runtime                                           | —                |
| `SINGULARITY_IMAGE`, `SINGULARITY_BINARY`                  | `singularity` runtime                                                  | —                |
| `DAYTONA_API_KEY` · `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Exec-only stub runtimes                                                | —                |
| `ANVIO_BROWSER_CDP_GRANT`                                  | `1` allows `browser_cdp` goto/click/fill                               | off              |
| `ANVIO_VISION_MODEL`                                       | Model used by `vision_analyze`                                         | `gpt-4o-mini`    |
| `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN`               | `ha_*` tools                                                           | —                |
| `X_BEARER_TOKEN`                                           | `x_search`                                                             | —                |
| `GITHUB_TOKEN`                                             | Default (disabled) GitHub MCP server in `mcp/servers.yaml`             | —                |
| `ANVIO_MCP_STUB`                                           | `1` disables real MCP connections (tests)                              | off              |

## Channels

| Channel         | Variables                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Telegram        | `TELEGRAM_BOT_TOKEN`                                                                                  |
| Discord         | `DISCORD_BOT_TOKEN`                                                                                   |
| Slack           | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`                                                                  |
| WhatsApp        | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`   |
| Microsoft Teams | `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_SERVICE_URL`                                             |
| Matrix          | `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`, `MATRIX_USER_ID`, `MATRIX_ROOM_ID`, `MATRIX_AS_TOKEN` |
| Mattermost      | `MATTERMOST_SERVER_URL`, `MATTERMOST_BOT_TOKEN`                                                       |
| Signal          | `SIGNAL_CLI_REST_URL` or `SIGNAL_CLI_PATH`, `SIGNAL_PHONE_NUMBER`                                     |
| Google Chat     | `GOOGLE_CHAT_WEBHOOK_URL` or `GOOGLE_CHAT_SERVICE_ACCOUNT` + `GOOGLE_CHAT_SPACE`                      |
| Email           | `EMAIL_SMTP_HOST` and related IMAP/SMTP settings                                                      |
| SMS (Twilio)    | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`                                       |

Channel tokens can also be referenced from `anvio.yaml` as `${VAR}`; they are expanded at load time.

## Memory, observability, infrastructure

| Variable                                                   | Description                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `HONCHO_API_KEY`, `HONCHO_BASE_URL`, `HONCHO_WORKSPACE_ID` | Honcho memory provider                                                              |
| `ANVIO_OTEL_ENABLED`                                       | `true` enables OpenTelemetry export (also implied by `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`         | Standard OTLP settings                                                              |
| `DATABASE_URL`                                             | PostgreSQL (Level 3+, `packages/db`)                                                |
| `NATS_URL`                                                 | NATS JetStream event bus (Level 3+)                                                 |

Variables ending in `_MOCK` or starting with `ANVIO_TEST_` exist only for the test suite and are not listed.
