# ADR-0031: A2A Server Authentication Layer

**Status:** Proposed  
**Date:** 2026-09-12  
**Deciders:** Platform team, security  
**Supersedes:** —  
**Related:** ADR-0026 (A2A Protocol Integration), ADR-0022 (One Transport Security Module)

## Context

`A2AServer` currently uses `UserBuilder.noAuthentication` — every request is accepted without identity verification. This is acceptable for local development but unacceptable for any network-exposed deployment.

The A2A protocol spec defines authentication via:

1. **Agent Card `securitySchemes`** — declares supported auth methods (API key, OAuth2, HTTP bearer, mTLS).
2. **Agent Card `securityRequirements`** — declares which schemes are required.
3. **Per-skill `securityRequirements`** — optional per-skill auth requirements.

The SDK provides:

- `UserBuilder` — interface for extracting user identity from requests.
- `ServerCallContext` — carries the authenticated user through the request pipeline.
- `User` / `UnauthenticatedUser` — identity types.

Anvio already has `packages/auth` (optional, off by default) for API/JWT authentication, and ADR-0022 established the one-transport-security-module pattern.

### Forces

1. **Progressive tiers**: Level 1 = no auth (local dev). Level 2+ = auth required for network exposure.
2. **Existing auth module**: `packages/auth` provides JWT validation, API key checking, and role-based access. Should reuse, not duplicate.
3. **A2A spec compliance**: Agent Card must accurately advertise auth requirements.
4. **SDK integration**: Must implement `UserBuilder` interface for Express transport handlers.
5. **Credential management**: ADR-0022's one-transport-security-module pattern applies — auth config lives in `anvio.yaml`, not per-transport.

## Decision

### 1. Configuration in `anvio.yaml`

```yaml
a2a:
  enabled: true
  auth:
    enabled: false              # default: false (Level 1 = no auth)
    schemes:
      - type: apiKey
        name: X-API-Key
        in: header
      - type: http
        scheme: bearer
        bearerFormat: JWT
    # API keys for static key auth
    apiKeys:
      - key: ${A2A_API_KEY_1}
        name: 'external-partner'
        scopes: ['sendMessage', 'getTask']
      - key: ${A2A_API_KEY_2}
        name: 'internal-agent'
        scopes: ['*']
    # JWT config for bearer auth
    jwt:
      issuer: 'https://auth.example.com'
      audience: 'anvio-a2a'
      jwksUrl: 'https://auth.example.com/.well-known/jwks.json'
```

### 2. UserBuilder Implementation

```typescript
// packages/a2a/src/server/anvio-user-builder.ts
import type { UserBuilder } from '@a2a-js/sdk/server/express';
import type { Request } from 'express';
import type { User } from '@a2a-js/sdk/server';

export class AnvioUserBuilder implements UserBuilder {
  constructor(
    private readonly authConfig: A2AAuthConfig,
    private readonly authModule?: AuthModule,  // from packages/auth
  ) {}

  async build(req: Request): Promise<User> {
    if (!this.authConfig.enabled) {
      return { id: 'anonymous', name: 'anonymous', scopes: ['*'] };
    }

    // Try API key first
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      const keyEntry = this.authConfig.apiKeys?.find(k => k.key === apiKey);
      if (!keyEntry) throw new AuthenticationError('Invalid API key');
      return { id: keyEntry.name, name: keyEntry.name, scopes: keyEntry.scopes };
    }

    // Try Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const claims = await this.authModule!.validateJwt(token);
      return { id: claims.sub, name: claims.name ?? claims.sub, scopes: claims.scopes ?? ['*'] };
    }

    throw new AuthenticationError('No credentials provided');
  }
}
```

### 3. Agent Card Security Metadata

When auth is enabled, `buildAgentCard()` populates:

```json
{
  "securitySchemes": {
    "apiKey": { "type": "apiKeySecurityScheme", "in": "header", "name": "X-API-Key" },
    "bearer": { "type": "httpAuthSecurityScheme", "scheme": "bearer", "bearerFormat": "JWT" }
  },
  "securityRequirements": [
    { "schemes": { "apiKey": {} } },
    { "schemes": { "bearer": {} } }
  ]
}
```

This tells external clients which auth methods are accepted.

### 4. Scope-Based Authorization

Scopes control what authenticated users can do:

| Scope | Operations |
|---|---|
| `sendMessage` | `sendMessage`, `sendMessageStream` |
| `getTask` | `getTask`, `listTasks` |
| `cancelTask` | `cancelTask` |
| `pushNotification` | `set/get/delete/listTaskPushNotificationConfig` |
| `*` | All operations |

Scope checking happens in `AnvioUserBuilder.build()` → `ServerCallContext` → `DefaultRequestHandler` enforces.

### 5. Integration with `packages/auth`

- When `packages/auth` is available (Level 2+), JWT validation delegates to its `AuthModule`.
- When `packages/auth` is not available (Level 1), only API key auth works.
- No circular dependency: `packages/a2a` imports `packages/auth` as optional peer dependency.

### 6. Transport to A2AServer

```typescript
// In a2a-server.ts constructor, replace:
UserBuilder.noAuthentication
// With:
this.authConfig.enabled 
  ? new AnvioUserBuilder(this.authConfig, authModule)
  : UserBuilder.noAuthentication
```

## Consequences

### Positive

- Network-exposed A2A endpoints are secured with industry-standard auth.
- Agent Card accurately advertises auth requirements — clients know what to send.
- Reuses `packages/auth` — no duplicate JWT/key validation logic.
- Progressive: no auth at Level 1, API key at Level 2, full JWT+OAuth at Level 3.
- Scope-based authorization provides fine-grained access control.

### Negative

- API key auth is simple but less secure than JWT (no expiry, no rotation without config change).
- `packages/auth` becomes an optional dependency of `packages/a2a` — adds coupling.
- JWKS URL must be reachable at startup for JWT validation.

### Risks

- API key comparison must be constant-time to prevent timing attacks.
- JWT validation failure should not leak internal details (issuer, audience) in error messages.
- Rate limiting not addressed here — should be added at gateway level to prevent brute-force key guessing.
