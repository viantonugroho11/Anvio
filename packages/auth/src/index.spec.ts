import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { createAuthProvider, JwtAuthProvider, NoAuthProvider } from './index.js';

const SECRET = 'a-very-long-random-test-secret-0123456789';

describe('createAuthProvider', () => {
  it('returns NoAuthProvider when auth is disabled', () => {
    const auth = createAuthProvider({ enabled: false, provider: 'jwt' });
    expect(auth).toBeInstanceOf(NoAuthProvider);
  });

  it('refuses to build a JWT provider without a secret', () => {
    expect(() => createAuthProvider({ enabled: true, provider: 'jwt' })).toThrow(/JWT_SECRET/);
    expect(() =>
      createAuthProvider({ enabled: true, provider: 'jwt' }, { jwtSecret: '  ' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('warns but accepts a short secret', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = createAuthProvider({ enabled: true, provider: 'jwt' }, { jwtSecret: 'short' });
    expect(auth).toBeInstanceOf(JwtAuthProvider);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('JwtAuthProvider', () => {
  const auth = new JwtAuthProvider(SECRET, 'local-user');

  it('accepts a token signed with the configured secret', async () => {
    const token = jwt.sign({ sub: 'alice', roles: ['admin'] }, SECRET, { algorithm: 'HS256' });
    await expect(auth.authenticate(token)).resolves.toMatchObject({
      userId: 'alice',
      roles: ['admin'],
      provider: 'jwt',
    });
  });

  it('rejects a token forged with the old dev-secret fallback', async () => {
    const forged = jwt.sign({ sub: 'alice' }, 'dev-secret');
    await expect(auth.authenticate(forged)).resolves.toBeNull();
  });

  it('rejects unsigned tokens and other algorithms', async () => {
    const unsigned = jwt.sign({ sub: 'alice' }, '', { algorithm: 'none' });
    await expect(auth.authenticate(unsigned)).resolves.toBeNull();
    const hs512 = jwt.sign({ sub: 'alice' }, SECRET, { algorithm: 'HS512' });
    await expect(auth.authenticate(hs512)).resolves.toBeNull();
  });

  it('returns null when no token is supplied', async () => {
    await expect(auth.authenticate()).resolves.toBeNull();
  });
});
