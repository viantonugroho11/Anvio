# ADR-0021: Authenticating the channel webhooks

## Status

Accepted — shipped in `apps/api`. Closes issue #31, which ADR-0018 D5 opened against itself.

## Context

ADR-0018 put every controller behind `AnvioAuthGuard` and marked three of them `@Public()`: the WhatsApp, Teams, and Matrix webhooks. That exemption is correct in kind — Meta, Microsoft, and a Matrix homeserver post to those endpoints and none of them can present a user bearer token — and `@Public()` was written down as _"outside the guard model"_, never as _"safe"_.

Issue #31 recorded what that left behind. **Only WhatsApp verified anything, and only on the handshake.** `whatsapp.controller.ts` checked `hub.verify_token` on the GET; `teams.controller.ts` and `matrix.controller.ts` contained no reference to a token, secret, signature, or HMAC at all. `POST /api/channels/teams/webhook` and `POST /api/channels/matrix/webhook` accepted anything from anyone who could reach them.

Since ADR-0018 that is loopback by default, which contains the blast radius without fixing it: these endpoints exist precisely to be reachable by an external service, so any real deployment exposes them. A post to the Matrix webhook injects a message attributed to any `senderId` the caller names — into an agent that reads it, acts on it, and spends model credits doing so.

The WhatsApp GET check is also weaker than it looks. It proves the endpoint belongs to this operator, once, at configuration time. It says nothing about who is posting afterwards.

## Decision

### D1 — Each provider is verified by its own mechanism

There is no shared secret to check, because these three callers do not share a protocol. One module, `apps/api/src/webhook-auth.ts`, holds three verifiers:

| Provider        | Mechanism                                                                                                         | What it proves                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Meta / WhatsApp | HMAC-SHA256 of the raw body against the app secret, as `X-Hub-Signature-256`                                      | The body arrived unmodified from someone holding the app secret |
| Matrix          | `as_token` from the registration file, as a bearer token or the legacy `?access_token=`                           | The caller holds the application-service secret                 |
| Teams           | Bot Framework JWT: RS256 against Microsoft's published keys, then issuer, audience, validity window, `serviceUrl` | Microsoft signed this token, for _this_ bot, recently           |

Every function is pure apart from the JWKS fetch, which is injected — so the whole surface is testable without a network.

### D2 — Fail closed when nothing is configured

A webhook with no secret configured returns 401 rather than accepting. That is the entire bug this ADR fixes, and the operator who has not configured a secret is exactly the one who will not notice the endpoint is open.

The escape hatch is `ANVIO_API_ALLOW_INSECURE`, **reused rather than duplicated**. ADR-0018 already defines it as "this deployment accepts an unauthenticated surface", which is the same declaration being made here. Anyone who set it to expose an unauthenticated API off loopback has already made this choice explicitly, and a second flag would only let the two drift out of agreement.

### D3 — The raw request body, or nothing

Meta signs the bytes it sent. `JSON.stringify(req.body)` round-trips through the parser and can differ on key order, unicode escaping, or whitespace — so verifying against a re-serialisation produces failures that have nothing to do with authenticity, and would push someone toward loosening the check to make it "work".

`NestFactory.create(AppModule, { rawBody: true })` keeps the original bytes on `req.rawBody`. When they are absent the verifier refuses outright; it never falls back to a reconstruction.

### D4 — The JWT algorithm is pinned, and the audience is checked

Two failure modes that a signature check alone does not cover:

- **`alg` is pinned to RS256, not read from the token.** Trusting the token's own `alg` is how `alg: none` and HS256-signed-with-the-public-key forgeries get accepted. This is refused before any key is looked up — so a forged token costs no network call.
- **`aud` must equal this bot's app id.** Microsoft signs tokens for _every_ Bot Framework bot with the same keys. A validly signed token minted for someone else's bot would otherwise pass, and any bot on the platform could post here.

`serviceUrl` is compared against the activity body when both are present: Bot Framework binds the callback host into the token, so a mismatch means the token was minted for a different endpoint and replayed.

### D5 — Implemented on `node:crypto`, no new dependency

Node builds a public key straight from a JWK and verifies RS256 directly. The alternative was two dependencies in `apps/api` — a JWT library and a JWKS client — for roughly sixty lines of work, in an app whose dependency list is currently five packages.

Keys are cached with a 24-hour TTL, and an unknown `kid` forces exactly one refetch. Microsoft rotates signing keys; a cache older than the rotation would otherwise reject legitimate traffic until it expired on its own.

### D6 — A key-lookup failure is 503, not 401

If Microsoft's key endpoint cannot be reached, the check could not run. That is a different fact from the caller failing it, and it must not become an open endpoint: an upstream outage is not authorisation. The endpoint answers 503 and names the error.

### D7 — Authenticate before touching platform state

All three controllers previously looked up their adapter first and answered 404 when the channel was not registered. To an unverified caller that is a configuration oracle: it reports which channels this deployment runs. The auth check now runs first in all three.

**This was found by running the server, not by the tests.** The first implementation moved the check ahead of the lookup in Teams and Matrix and left WhatsApp in its original order — so `POST /channels/whatsapp/webhook` answered `404 WhatsApp channel not enabled` to a completely unauthenticated request, and the signature path was unreachable in that deployment. The 26 unit tests all passed; they exercise the verifiers, and the defect was in the controller's ordering.

## Consequences

**Positive**

- The two endpoints that accepted anything from anyone no longer do.
- WhatsApp is verified on every POST, not only on the one-time handshake.
- A forged `alg: none` token is rejected without a network call.
- No new dependency in `apps/api`.
- Verified end to end against a running server: every rejection path returns 401 with a specific reason, and each accept path passes through to the handler.

**Negative**

- **Existing deployments break until configured.** A Teams or Matrix webhook that worked yesterday returns 401 today unless `TEAMS_APP_ID` / `MATRIX_AS_TOKEN` is set or the deployment declares itself insecure. That is the intended direction — the previous behaviour was the defect — but it is a breaking change and release notes must lead with it.
- **`WHATSAPP_VERIFY_TOKEN` still defaults to `'anvio-verify'`** in `packages/channels`, a publicly-known value in a public repository. The POST signature check makes the handshake much less load-bearing, but a hardcoded default secret should not exist at all. Out of scope here — it lives in another package and removing the default is its own breaking change — and filed as issue #39 rather than left implicit.
- **No replay protection.** A captured, validly signed request can be replayed within the token's validity window (Teams) or indefinitely (Matrix, WhatsApp — neither carries a timestamp Anvio checks). Meta sends no nonce, so deduplication would have to key on message id in the channel layer.
- **The Bot Framework JWKS is fetched at first use**, so the first Teams webhook after a restart pays two round-trips.
- **Government and sovereign Bot Framework clouds use different issuers and metadata endpoints.** Only the public cloud is handled.

## Cross-references

- ADR-0018: API network exposure — introduced the guard and the `@Public()` exemption this ADR fills in, and defines the `ANVIO_API_ALLOW_INSECURE` flag reused by D2.
- Issue #31: the gap, recorded against ADR-0018 D5 at the time it was created.
