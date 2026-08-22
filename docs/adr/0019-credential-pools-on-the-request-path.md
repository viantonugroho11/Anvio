# ADR-0019: Credential pools reach the request path

## Status

Accepted — shipped in `packages/platform`, `packages/models`, `packages/credentials`, `apps/cli`. Closes issue #22. Discharges the correction note ADR-0017 D5 left on ADR-0011.

## Context

ADR-0011 stated: *"the router calls `credentialPools.acquire(poolId)` and constructs a provider on the fly for each request when `target.pool` is set in `routing.yaml`."*

Three separate things made that false, and each would have been enough on its own.

**The manager was never built.** `@anvio/credentials` was not a dependency of `packages/platform`, so `createPlatform()` could not construct one. Its only importer was `apps/cli`. `ModelRouterDeps.credentialPools` was therefore always `undefined` in every process that serves a request.

**The router discarded the key even when given one.** `resolveProvider` read:

```ts
if (target.pool && this.deps.credentialPools) {
  const acquired = await this.deps.credentialPools.acquire(target.pool);
  apiKey = acquired.value;          // ← acquired
}
const existing = this.deps.providers.get(target.provider);
if (existing) return existing;      // ← and dropped
```

`acquire()` advances round-robin position and usage counters, and can mark a credential rate-limited. All of that happened, then the registry's env-var-backed provider was returned instead. Had a manager ever been supplied, the pool would have rotated busily while every request went out under a single unrotated key.

**A key written at runtime could not take effect.** `ModelProviderRegistry` wraps a `Map` built once during `createPlatform()`, with no way to add or replace an entry afterwards. Adding a credential meant restarting the process.

Separately, `apps/cli` defaulted the encryption passphrase to the literal `'local-dev-passphrase'`. `EncryptedCredentialStore` derives its key from that passphrase with `scryptSync` and stores the salt beside the ciphertext — so anyone who could read `workspace/credentials/encrypted/*.enc.json` could decrypt it with a value published in this repository. The connect broker in the same file already refuses to run without its key; credential pools did not.

## Decision

### D1 — The pool is the authority for its target's key

When a route target names a pool and a manager exists, the acquired credential is what goes on the wire. The registry is consulted only for targets with no pool.

Providers are cached per `provider:credentialId:model`, so rotation still produces a different client while a stable credential does not rebuild an SDK client on every call. `acquire()` is called on every request regardless — rotation and rate-limit bookkeeping have to stay live; only client construction is memoised.

A target that is neither registered nor pool-backed now raises a typed `AnvioError` naming both possibilities, rather than a bare `Error` saying only "Provider not registered".

### D2 — No passphrase means the feature is off, not weakly encrypted

`createPlatform()` builds a pool manager only when `ANVIO_CREDENTIALS_PASSPHRASE` is set; otherwise `credentialPools` is `undefined` and pooled routing is simply unavailable. `apps/cli` refuses to run `anvio credentials` without it, following the pattern the connect broker already used.

The alternative — keep a default so nothing breaks — was rejected because it makes encryption-at-rest a claim the code cannot support. Absence of a passphrase must degrade to *no feature*, never to *weaker feature*.

**This is a breaking change with data loss.** Pools written under the old built-in default cannot be read with a new passphrase. The error says so and points at `anvio credentials add`. The data at risk is API keys that still exist at the vendor and can be re-pasted; the protection they had was nil.

### D3 — The registry accepts writes

`ModelProviderRegistry` gains `upsert()` and `remove()`. Without them a key-management UI could write a credential and the running process would keep using the old one until restarted, which is the kind of gap that reads as a bug to every user who hits it.

### D4 — `testPool` echoes nothing of the secret

It reported `${value.slice(0, 4)}...`. For a vendor-prefixed key that is near-zero entropy, which is why an earlier audit pass rated it ignorable — but it is printed by the CLI today and will cross HTTP as soon as a settings page calls it. It now reports the credential id and a length.

## Consequences

**Positive**

- `routing.yaml`'s `pool:` field does something for the first time, and a test asserts the key on the wire rotates (`sk-key-a`, `sk-key-b`, `sk-key-a`) rather than inferring it from behaviour.
- ADR-0011's rotation claim is true as written.
- Encryption at rest is either real or absent, with nothing in between.
- `PlatformContext.credentialPools` gives the key-management UI (5c) something to call.

**Negative**

- **Existing pools encrypted under `'local-dev-passphrase'` become unreadable.** Deliberate — see D2 — but it is data loss and the release notes must lead with it.
- Pooled providers are cached for the process lifetime, keyed by credential id. A credential *rotated in place* under the same id keeps serving the old client until restart. Rotating by adding a new id and disabling the old one behaves correctly; same-id rotation needs cache invalidation that does not exist yet.
- `credentialPools` is optional on `PlatformContext`, so every consumer must handle its absence. That is honest — the feature really is optional — but it is a branch at each call site.
- Nothing yet *writes* credentials from anywhere but the CLI. `upsert()` exists for a caller that does not exist yet; issue #22 is closed, the UI is not built.

## Cross-references

- ADR-0011: model provider auth and switching — its credential-pool claim is now accurate; the correction note added by ADR-0017 D5 can be read as discharged.
- ADR-0017: streaming provider failover — supplied the router that this ADR gives real credentials to.
- ADR-0018: API network exposure — the prerequisite. A key-management surface had to wait for an API that is not open by default.
