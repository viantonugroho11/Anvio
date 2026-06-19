# Development Guide

## Prerequisites

Node 20+, pnpm 9+, Docker

## Setup

1. pnpm install
2. cp .env.example .env
3. docker compose -f docker/docker-compose.dev.yml up -d
4. pnpm db:migrate && pnpm db:seed
5. pnpm dev
