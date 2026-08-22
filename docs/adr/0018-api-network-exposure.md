# ADR-0018: The API refuses to be both unauthenticated and reachable

## Status

Accepted — shipped in `apps/api/src/{security.ts,auth.guard.ts,main.ts,app.module.ts}`. Closes issue #23. Prerequisite for the credential-pool and key-management work (ADR-0011 correction, issue #22).

## Context

`apps/api` shipped four properties that were individually defensible and collectively meant anything on the LAN could spend model credits:

| Property | Where |
|---|---|
| `app.enableCors()` with no origin restriction | `main.ts` |
| Listening on `0.0.0.0` by default | `main.ts` — and nothing in the repo, `.env.example`, or docker config ever set `API_HOST`, so every deployment took that default |
| No guard registered | `app.module.ts` |
| Eight of nine controllers never reading the `authorization` header | grep across `*.controller.ts` |

The ninth, `sessions.controller.ts`, did check — and got it wrong in the way that matters:

```ts
const ctx = await auth.authenticate(token);
return ctx ?? auth.getDefaultContext();
```

An invalid, expired, or entirely absent token resolved back to a valid default user context. Turning `auth.enabled` on in `workspace/anvio.yaml` did not close the door; it only added a lock that opened when picked.

`POST /api/sessions` and `POST /api/sessions/:id/messages` start agent runs. That is real money.

## The distinction this ADR rests on

**"No auth" is not the problem.** Running without a login is the intended Level-1 default for a local-first, single-user product, and forcing a login on `localhost` would break the thing people actually use. ADR-0007 commits to that posture.

The dangerous state is **no auth _and_ reachable from the network**. Those two are individually fine and jointly unacceptable, so the fix targets the conjunction rather than either half.

## Decision

### D1 — Loopback by default; a reachable host is an explicit choice

`API_HOST` defaults to `127.0.0.1`. Loopback detection covers the whole `127.0.0.0/8` block plus `::1` and `localhost`, not just the one literal.

### D2 — Refuse to start on the dangerous combination

`assertSafeBinding` throws when auth is disabled and the host is not loopback, unless `ANVIO_API_ALLOW_INSECURE=true`.

Deliberately **not** a silent downgrade to loopback: an operator who wrote `API_HOST=0.0.0.0` meant it, and should learn why they did not get it rather than spend an afternoon on an unreachable service. The error names all three ways forward — unset the host, enable auth, or accept the risk — and a test asserts it does.

The escape hatch exists because the combination is legitimate behind a container network or a private VPC, where the isolation is real but invisible to this process. Removing the hatch would push people to disable something else, and pretending we can detect that isolation from inside the process would be a lie.

### D3 — CORS reflects only loopback origins unless told otherwise

`ANVIO_API_CORS_ORIGINS` takes a comma-separated allowlist. With none set, only `http(s)://localhost|127.0.0.1|[::1]` with any port are reflected — which covers the dashboard. Requests with no `Origin` header (non-browser callers) pass, since CORS is a browser mechanism and blocking them would break `curl` without protecting anything.

### D4 — One global guard, not nine controllers

`AnvioAuthGuard` is registered via `APP_GUARD`, so a controller added tomorrow is protected by default rather than by someone remembering. It establishes the context once and hands it to handlers through an `@Auth()` param decorator; `sessions.controller.ts` no longer does its own resolution, which is how the fallback bug is removed at the root rather than patched.

**With auth enabled, a failed `authenticate()` is a 401.** No fallback.

### D5 — Two kinds of route are public, and only two

`@Public()` marks:

- **Health** — liveness probes cannot carry credentials.
- **Channel webhooks** (`whatsapp`, `teams`, `matrix`) — Meta, Microsoft, and a Matrix homeserver post to us and cannot present a user's bearer token. They authenticate by their own mechanism, and the guard must not invent an identity for them.

That second group is a real gap, not a resolved one: only WhatsApp verifies anything today (`hub.verify_token` on the GET handshake). Teams and Matrix accept unauthenticated POSTs. Marking them `@Public()` records that they are outside this guard's model; it does not claim they are safe. Separate work.

## Consequences

**Positive**

- The default install is no longer network-reachable, and the previous default was reached by accident rather than choice.
- Enabling auth now actually enables auth.
- New controllers are guarded without anyone deciding to guard them.
- 29 tests pin the policy, including that the refusal message names every way out.

**Negative**

- **Anyone relying on the old `0.0.0.0` default loses access on upgrade.** That is the point of the change, but it is a breaking change for anyone who was reaching the API across a network — they now get a startup error with instructions instead of a running service. `.env.example` documents the three env vars.
- Docker and similar deployments must now set `API_HOST=0.0.0.0` **and** either enable auth or set `ANVIO_API_ALLOW_INSECURE=true`.
- `apps/web` still sends no `Authorization` header (`lib/api.ts` is a bare GET helper), so the dashboard works only with auth disabled. Unchanged by this ADR — it never sent one — but now it is a stated limit rather than an accident, and it is what the key-management UI work has to fix.
- Teams and Matrix webhooks remain unauthenticated (D5).

## Cross-references

- ADR-0007: local-first architecture — the Level-1 no-auth default this ADR preserves rather than overrides.
- ADR-0011: model provider auth — its credential-pool gap (issue #22) is the next step, and had to wait for this one.
