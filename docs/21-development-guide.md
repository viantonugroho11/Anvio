# Development Guide

## End-user install

```bash
curl -fsSL https://raw.githubusercontent.com/viantonugroho11/Anvio/main/scripts/install.sh | bash
anvio chat
```

See [`scripts/install.sh`](../scripts/install.sh) for options (`--workspace`, `--bin-dir`).

## Prerequisites (contributors)

Node 20+, pnpm 9+. Docker/PostgreSQL are **optional** (Level 3+ only).

## Setup (from source)

1. `pnpm install`
2. `pnpm build`
3. `pnpm anvio chat` — Level 1, no Docker

Optional Level 3:

1. `cp .env.example .env`
2. `docker compose -f docker/docker-compose.dev.yml up -d`
3. `pnpm db:migrate && pnpm db:seed`
4. `pnpm dev`
