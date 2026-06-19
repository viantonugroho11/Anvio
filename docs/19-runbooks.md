# Runbooks

## Start Services

docker compose -f docker/docker-compose.dev.yml up -d
pnpm db:migrate && pnpm db:seed
pnpm dev

## Health Checks

- API: GET /health
- NATS: http://localhost:8222/healthz
