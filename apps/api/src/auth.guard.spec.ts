import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthContext, AuthProvider } from '@anvio/core';
import { AnvioAuthGuard } from './auth.guard.js';
import type { AppService } from './app.service.js';

const VALID: AuthContext = { userId: 'alice', roles: ['user'], provider: 'jwt' };
const ANON: AuthContext = { userId: 'local-user', roles: ['user'], provider: 'none' };

function guardWith(auth: AuthProvider, isPublic = false) {
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as import('@nestjs/core').Reflector;
  const appService = { platform: { auth } } as unknown as AppService;
  return new AnvioAuthGuard(reflector, appService);
}

function contextWith(authorization?: string) {
  const request: Record<string, unknown> = { headers: { authorization } };
  return {
    request,
    ctx: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as import('@nestjs/common').ExecutionContext,
  };
}

const enabledAuth: AuthProvider = {
  enabled: true,
  authenticate: async (token) => (token === 'good-token' ? VALID : null),
  getDefaultContext: () => ANON,
};

const disabledAuth: AuthProvider = {
  enabled: false,
  authenticate: async () => null,
  getDefaultContext: () => ANON,
};

describe('AnvioAuthGuard with auth enabled', () => {
  it('rejects a request with no token', async () => {
    const { ctx } = contextWith(undefined);
    await expect(guardWith(enabledAuth).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid token instead of falling back to a default context', async () => {
    // This is the bug the guard replaces: the old controller resolved a failed
    // authenticate() back to getDefaultContext(), so a bad token still produced
    // a valid user identity with auth switched on.
    const { ctx, request } = contextWith('Bearer expired-token');
    await expect(guardWith(enabledAuth).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(request.authContext).toBeUndefined();
  });

  it('accepts a valid token and attaches its context', async () => {
    const { ctx, request } = contextWith('Bearer good-token');
    await expect(guardWith(enabledAuth).canActivate(ctx)).resolves.toBe(true);
    expect(request.authContext).toEqual(VALID);
  });

  it('parses the scheme case-insensitively and tolerates extra whitespace', async () => {
    const { ctx, request } = contextWith('  bearer   good-token  ');
    await expect(guardWith(enabledAuth).canActivate(ctx)).resolves.toBe(true);
    expect(request.authContext).toEqual(VALID);
  });

  it('rejects a token sent without the Bearer scheme', async () => {
    const { ctx } = contextWith('good-token');
    await expect(guardWith(enabledAuth).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lets a public route through untouched', async () => {
    const { ctx, request } = contextWith(undefined);
    await expect(guardWith(enabledAuth, true).canActivate(ctx)).resolves.toBe(true);
    // Webhooks authenticate their own way; the guard must not invent an identity.
    expect(request.authContext).toBeUndefined();
  });
});

describe('AnvioAuthGuard with auth disabled', () => {
  it('attaches the anonymous context without demanding a token', async () => {
    // Level-1 default: no login, single local user.
    const { ctx, request } = contextWith(undefined);
    await expect(guardWith(disabledAuth).canActivate(ctx)).resolves.toBe(true);
    expect(request.authContext).toEqual(ANON);
  });
});
