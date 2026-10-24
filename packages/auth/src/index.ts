import jwt from 'jsonwebtoken';
import type { AuthConfig, AuthContext, AuthProvider } from '@anvio/core';
import { AnvioError } from '@anvio/core';

/** HS256 keys shorter than the hash output (32 bytes) are brute-forceable offline. */
const RECOMMENDED_JWT_SECRET_LENGTH = 32;

/** Default: no login, no registration — agents run immediately. */
export class NoAuthProvider implements AuthProvider {
  readonly enabled = false;
  private readonly defaultUserId: string;

  constructor(defaultUserId = 'local-user') {
    this.defaultUserId = defaultUserId;
  }

  async authenticate(_token?: string): Promise<AuthContext | null> {
    return this.getDefaultContext();
  }

  getDefaultContext(): AuthContext {
    return {
      userId: this.defaultUserId,
      roles: ['user'],
      provider: 'none',
    };
  }
}

export class JwtAuthProvider implements AuthProvider {
  readonly enabled = true;

  constructor(
    private readonly secret: string,
    private readonly defaultUserId: string,
  ) {}

  async authenticate(token?: string): Promise<AuthContext | null> {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as {
        sub: string;
        email?: string;
        roles?: string[];
      };
      return {
        userId: payload.sub,
        email: payload.email,
        roles: payload.roles ?? ['user'],
        provider: 'jwt',
      };
    } catch {
      return null;
    }
  }

  getDefaultContext(): AuthContext {
    return { userId: this.defaultUserId, roles: ['user'], provider: 'none' };
  }
}

/** OAuth2 provider stub — only activated when MCP/external integration requires it. */
export class OAuth2AuthProvider implements AuthProvider {
  readonly enabled = true;

  constructor(private readonly defaultUserId: string) {}

  async authenticate(_token?: string): Promise<AuthContext | null> {
    throw new Error('OAuth2 auth requires provider-specific token exchange (Phase 2+)');
  }

  getDefaultContext(): AuthContext {
    return { userId: this.defaultUserId, roles: ['user'], provider: 'none' };
  }
}

export function createAuthProvider(
  config: AuthConfig,
  options?: { jwtSecret?: string; defaultUserId?: string },
): AuthProvider {
  const defaultUserId = options?.defaultUserId ?? 'local-user';

  if (!config.enabled) {
    return new NoAuthProvider(defaultUserId);
  }

  switch (config.provider) {
    case 'jwt':
      return new JwtAuthProvider(requireJwtSecret(options?.jwtSecret), defaultUserId);
    case 'oauth2':
      return new OAuth2AuthProvider(defaultUserId);
    case 'none':
    default:
      return new NoAuthProvider(defaultUserId);
  }
}

/**
 * A missing secret used to fall back to a hard-coded `'dev-secret'`, so enabling
 * JWT auth without `JWT_SECRET` let anyone mint a token for any user (audit CQ-001).
 * Refusing to start is the only safe outcome.
 */
function requireJwtSecret(secret: string | undefined): string {
  if (!secret || secret.trim() === '') {
    throw new AnvioError(
      'VALIDATION_ERROR',
      'auth.provider is "jwt" but JWT_SECRET is not set. Set JWT_SECRET (at least 32 characters) or disable auth.',
    );
  }
  if (secret.length < RECOMMENDED_JWT_SECRET_LENGTH) {
    console.warn(
      `[auth] JWT_SECRET is shorter than ${RECOMMENDED_JWT_SECRET_LENGTH} characters; use a longer random secret.`,
    );
  }
  return secret;
}
