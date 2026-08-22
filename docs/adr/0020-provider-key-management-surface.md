# ADR-0020: A surface for pasting provider keys

## Status

Accepted — shipped in `apps/api`, `apps/web`, `apps/cli`. Phase 5c, the last of the provider-audit plan. Depends on ADR-0018 (a guarded API) and ADR-0019 (somewhere for keys to live).

## Context

ADR-0019 gave keys a home and put pools on the request path, but the only way to put a key in one was `anvio credentials add … --value <secret>` — which leaves the secret in the process argv, visible to `ps` and saved in shell history. The dashboard had no settings surface at all, and `apps/web` sent no `Authorization` header, so it could only ever work with auth disabled.

The honest framing matters here, and the page says it out loud: **most vendors have no way to hand a key to another application.** There is nothing to sign in to. OpenAI, DeepSeek, Groq, Mistral, Together and xAI all issue static keys from their own dashboards. A "Connect provider" button would be inventing a protocol. What this surface can do is accept a pasted key, encrypt it, and prove it works.

## Decision

### D1 — Server actions, so no secret and no token reaches the browser

The form posts to a Next server action, which calls the API. Two things stay server-side as a result: `ANVIO_API_TOKEN` (deliberately not `NEXT_PUBLIC_`, so it is absent from the browser bundle), and the composed request carrying the pasted key. The client sends form fields to Next; Next talks to the API.

A client-side `fetch` would have needed the API token in the browser to work with auth enabled, which defeats having a token.

### D2 — The response shape is built field by field

`PoolView` is constructed explicitly rather than by spreading the stored pool. Nothing is copied wholesale, so a secret cannot ride out through a field nobody remembered to strip — including `encryptedRef`, and including whatever is added to `CredentialPool` later. A test asserts `encryptedRef` is absent and that no `sk-` prefix appears in a write response.

Adding a key echoes `{ slug, id }`. Not a masked value, not a prefix — the id and nothing else.

### D3 — Disabled is a 503 with the fix, not a 500

Without `ANVIO_CREDENTIALS_PASSPHRASE` the platform builds no pool manager (ADR-0019 D2). That is a configuration state, so the endpoints answer `503` naming the variable, and the page renders the message instead of an error boundary.

### D4 — The CLI stops requiring a secret in argv

`--value -` reads stdin; `--value-env NAME` reads an environment variable. `--value <secret>` still works and now prints a warning naming both alternatives, because breaking existing scripts to fix a leak they may not care about is not this ADR's call to make.

## What running it caught that the tests did not

Two bugs shipped in ADR-0018 meant **`apps/api` did not start at all**, and both were found by running it, not by the 29 tests written alongside it. Those tests exercise `security.ts` and `auth.guard.ts` as pure units — correctly, and uselessly for this class of fault.

1. `app.get(AppService)` ran before `app.init()`, so `platform` was still `undefined` and bootstrap threw. `NestFactory.create()` builds the container; only `init()` fires `onModuleInit`.
2. Adding `init()` then moved it ahead of `setGlobalPrefix('api')`. Routes are registered during init, so every route mounted without its prefix and the whole API 404'd.

The ordering is now: configure prefix and CORS → `init()` → read auth state → `assertSafeBinding` → `listen()`. The safety check has to sit after init (it needs `platform`) and before listen (it decides whether to open the port), and that squeeze is the only correct position.

A smoke test that boots the app and asserts one route answers would have caught both. There isn't one; that is a real gap this ADR does not close.

## Two things found while verifying

- **`workspace/credentials/` was not in `.gitignore`.** Encrypted pools and `workspace/connections/` OAuth tokens could have been committed. Both are ignored now. Encryption is not a reason to publish ciphertext whose passphrase belongs to the operator.
- **`apiFetch` used a relative URL from server components**, where Node's fetch rejects it. Every dashboard page has been failing this way; the existing pages swallow the error in a bare `catch` and render an empty state, so it read as "no data" rather than "broken". `BASE` now defaults to the API's own loopback default.

## Consequences

**Positive**

- A key can be added without putting it in argv, shell history, or a file.
- The API is exercised end to end: pools listed, key stored, `testPool` reporting `Acquired primary (24 chars)` with no part of the secret.
- The dashboard works out of the box against a default-local API.

**Negative**

- **The dashboard still cannot authenticate as a user.** `ANVIO_API_TOKEN` is a single static server-side token, not a login. With auth enabled every dashboard request is that one identity. Fine for one operator on one machine; not multi-user.
- **There is no delete or disable in the UI.** A leaked key can be superseded by adding a new credential, not revoked from here. Compounded by issue #33: a credential replaced under the same id keeps serving the old client until restart.
- **No boot smoke test**, per above.
- The dashboard layout is a fixed 224px sidebar with `ml-56` content and no responsive handling, so it is unusable below roughly 700px. Pre-existing and untouched here.

## Cross-references

- ADR-0018: API network exposure — the guard this surface relies on, and the source of the two bootstrap bugs fixed here.
- ADR-0019: credential pools on the request path — what makes a pasted key actually reach a provider.
- Issue #33: a credential rotated in place under the same id keeps serving the old client.
