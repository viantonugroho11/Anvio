# ADR-0022: One transport-security module for both HTTP surfaces

## Status

Accepted — shipped in `packages/platform` and `apps/api`. Closes issue #42.

## Context

Four things in this repository open a port. Three were fine: `apps/api` had been hardened by ADR-0018 and ADR-0021, and both `packages/acp` and `packages/harness/src/connect/login-host.ts` default to `127.0.0.1`.

The fourth, `packages/platform/src/unified-gateway.ts`, turned out to be **a second implementation of the same HTTP surface** — and none of that hardening reached it. CLAUDE.md describes `anvio gateway start` as the bundled daemon: channel hub, worker, REST API, and WebSocket in one process. This is not a marginal path; it is how the platform is meant to be run.

Three defects, each an exact copy of one already fixed next door:

1. **`host` defaulted to `'0.0.0.0'`** (`unified-gateway.ts:83`), with no `assertSafeBinding`. ADR-0018 pulled `apps/api` back to loopback and made it refuse to start when an unauthenticated API would be reachable off it. One `anvio gateway start` made all of that irrelevant.
2. **`resolveAuth` ended `return ctx ?? auth.getDefaultContext()`** (`gateway-http.ts:23`). This is verbatim the bug ADR-0018 removed from `sessions.controller.ts`: a bad token, an expired token, or no token resolves to the default context and the request proceeds. Enabling `auth.enabled` did not close the door; it added a lock that opened when jiggled.
3. **The three channel webhooks dispatched unverified.** `gateway-http.ts` re-implements all of them, so ADR-0021's verification — signature, `as_token`, Bot Framework JWT — applied to neither Teams nor Matrix nor WhatsApp here. A POST to the gateway's Matrix webhook still injected a message attributed to any `senderId` the caller named.

Each is the same defect wearing a different hat: **the surface exists twice and only one copy gets fixed.**

## Decision

### D1 — The shared pieces move to `packages/platform`, not a new package

`apps/api/src/security.ts` → `packages/platform/src/http-binding.ts`
`apps/api/src/webhook-auth.ts` → `packages/platform/src/webhook-auth.ts`

Both were already pure: `security.ts` imported nothing at all, `webhook-auth.ts` only `node:crypto`. Neither has a Nest dependency, so nothing had to be untangled to move them.

`packages/platform` rather than a new package or `packages/core`:

- **`apps/api` already depends on `@anvio/platform`**, and the gateway _is_ platform. Both consumers reach it without a new workspace package or a change to the dependency rule (`apps → platform → packages → core`).
- **Not `core`.** Core is schemas, ports, and zod types with no internal dependencies. Runtime HMAC verification and network-binding policy are not that, and putting them there to satisfy a layering diagram would misfile them.
- **Not a new `packages/http-security`.** Defensible, and it is the right move if a third consumer appears — but it is boilerplate for two callers that already share a package.

The specs moved with their sources.

### D2 — `resolveAuth` returns null, and every caller handles it

The gateway's authenticated routes now answer 401 when authentication was required and failed. No fallback, matching `AnvioAuthGuard`.

### D3 — The gateway binds loopback and refuses an insecure binding

`assertSafeBinding` is called before `listen()`, with the same `ANVIO_API_ALLOW_INSECURE` escape hatch. The check needs the resolved auth state and decides whether to open the port at all, which is the same squeeze that fixed its position in `apps/api`.

### D4 — Webhooks are verified with the same functions, not equivalent ones

The gateway calls `verifyMetaSignature`, `verifyMatrixToken`, and `verifyTeamsJwt` — the same functions `apps/api` calls, not a second implementation of the same rules. A behavioural difference between the two surfaces is now only possible by changing one call site and not the other, which is a smaller and much more visible mistake than maintaining two copies of the logic.

One difference is unavoidable: the gateway has no body parser, so it reads the raw body itself and parses afterwards. That is _closer_ to correct than the Nest path, which needed `rawBody: true` to recover bytes the parser had already consumed.

### D5 — A regression spec that fails on the old behaviour

`gateway-http.spec.ts` asserts the gateway refuses a forged token without consulting `getDefaultContext`, that each webhook fails closed unconfigured, that the escape hatch is honoured, and that a valid HMAC reaches the handler. Restoring the old `?? auth.getDefaultContext()` turns exactly one test red.

## Consequences

**Positive**

- The hardening from ADR-0018 and ADR-0021 now covers the path the documentation recommends.
- Verified against a running gateway: every rejection path answers 401 with a specific reason, a correct credential reaches the handler, and the process **refuses to start** on `0.0.0.0` with auth disabled unless the operator says otherwise.
- Two fewer files in `apps/api`, and one place to change transport security.

**Negative**

- **The surface still exists twice.** This ADR removes the duplicated _logic_, not the duplicated _routing table_. Adding a route to `apps/api` still does not add it to the gateway, and a future route can still be added to one and forgotten in the other. Mounting the Nest app inside the gateway would close that for good, at the cost of a much larger diff and a Nest boot in the gateway — a deliberate deferral, not an oversight.
- **`anvio gateway start` on `0.0.0.0` is now a breaking change** for anyone who relied on the old default. Release notes must lead with it: the fix is `ANVIO_GATEWAY_HOST=0.0.0.0` plus either real auth or `ANVIO_API_ALLOW_INSECURE=true`.
- **Still no boot smoke test in CI.** The gateway was started and probed by hand for this change, exactly as ADR-0020 described doing for `apps/api`, and exactly as ADR-0020 said was not a substitute for a test. The gap is now two surfaces wide.
- `packages/platform` gains two modules that are not composition-root work. Defensible while there are two consumers; a third would argue for their own package.

## Cross-references

- ADR-0018: API network exposure — the binding policy and the `getDefaultContext` fallback, both fixed there and copied here.
- ADR-0021: channel webhook authentication — the verifiers this ADR shares out.
- ADR-0020: records that no boot smoke test exists; this ADR widens that gap rather than closing it.
- Issue #42: the finding, from a sweep for other listeners after #31 and #39.
