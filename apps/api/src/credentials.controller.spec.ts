import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthContext, CredentialPool, CredentialPoolManager } from '@anvio/core';
import { CredentialsController } from './credentials.controller.js';
import type { AppService } from './app.service.js';

const CTX: AuthContext = { userId: 'local-user', roles: ['user'], provider: 'none' };

const POOL: CredentialPool = {
  apiVersion: 'anvio.io/v1',
  kind: 'CredentialPool',
  metadata: { slug: 'anthropic' },
  spec: {
    provider: 'anthropic',
    strategy: 'round_robin',
    credentials: [
      { id: 'primary', encryptedRef: 'encrypted/anthropic.enc.json#primary', status: 'active' },
      {
        id: 'spare',
        encryptedRef: 'encrypted/anthropic.enc.json#spare',
        status: 'rate_limited',
        rateLimitedUntil: '2026-01-01T00:00:00.000Z',
      },
    ],
    rotation: { onRateLimit: 'rotate', cooldownSeconds: 60 },
    failover: { enabled: false },
  },
};

function controllerWith(pools?: Partial<CredentialPoolManager>) {
  const appService = {
    platform: { credentialPools: pools as CredentialPoolManager | undefined },
  } as unknown as AppService;
  return new CredentialsController(appService);
}

describe('CredentialsController with pools disabled', () => {
  it('answers 503 naming the passphrase, not a 500', async () => {
    // No passphrase means the feature is off (ADR-0019 D2) — a configuration
    // state, not a fault.
    const controller = controllerWith(undefined);

    await expect(controller.listPools(CTX)).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.listPools(CTX)).rejects.toThrow(/ANVIO_CREDENTIALS_PASSPHRASE/);
  });

  it('refuses writes too', async () => {
    const controller = controllerWith(undefined);
    await expect(
      controller.addCredential(CTX, 'anthropic', { id: 'primary', value: 'sk-secret' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('CredentialsController pool listing', () => {
  it('exposes ids and status, and nothing that could carry a secret', async () => {
    const controller = controllerWith({ listPools: async () => [POOL] });

    const [view] = await controller.listPools(CTX);

    expect(view).toEqual({
      slug: 'anthropic',
      provider: 'anthropic',
      strategy: 'round_robin',
      credentials: [
        { id: 'primary', status: 'active', rateLimitedUntil: undefined },
        { id: 'spare', status: 'rate_limited', rateLimitedUntil: '2026-01-01T00:00:00.000Z' },
      ],
    });

    // Built field by field rather than spread, so encryptedRef and anything added
    // to the stored shape later cannot ride along.
    expect(JSON.stringify(view)).not.toContain('encryptedRef');
  });
});

describe('CredentialsController writes', () => {
  it('stores the key and echoes back only its name', async () => {
    const addCredential = vi.fn(async () => {});
    const controller = controllerWith({ addCredential });

    const result = await controller.addCredential(CTX, 'anthropic', {
      id: 'primary',
      value: 'sk-super-secret-value',
    });

    expect(addCredential).toHaveBeenCalledWith('anthropic', 'primary', 'sk-super-secret-value');
    expect(result).toEqual({ slug: 'anthropic', id: 'primary' });
    // Not even a prefix: this response is rendered in a browser and may be logged.
    expect(JSON.stringify(result)).not.toContain('sk-');
  });

  it.each([
    ['missing value', { id: 'primary' }],
    ['missing id', { value: 'sk-secret' }],
    ['blank value', { id: 'primary', value: '   ' }],
    ['blank id', { id: '  ', value: 'sk-secret' }],
  ])('rejects a %s', async (_label, body) => {
    const addCredential = vi.fn(async () => {});
    const controller = controllerWith({ addCredential });

    await expect(controller.addCredential(CTX, 'anthropic', body)).rejects.toThrow(
      BadRequestException,
    );
    expect(addCredential).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from a pasted key', async () => {
    // Copying from a provider dashboard commonly picks up a trailing newline.
    const addCredential = vi.fn(async () => {});
    const controller = controllerWith({ addCredential });

    await controller.addCredential(CTX, 'anthropic', { id: ' primary ', value: ' sk-abc \n' });

    expect(addCredential).toHaveBeenCalledWith('anthropic', 'primary', 'sk-abc');
  });

  it('passes the test result through untouched', async () => {
    const controller = controllerWith({
      testPool: async () => ({ ok: true, message: 'Acquired primary (24 chars)' }),
    });

    expect(await controller.testPool(CTX, 'anthropic')).toEqual({
      ok: true,
      message: 'Acquired primary (24 chars)',
    });
  });
});
