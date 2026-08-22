import { createHmac, generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BOT_FRAMEWORK_ISSUER,
  BOT_FRAMEWORK_OPENID_URL,
  createBotFrameworkJwks,
  resolveWebhookSecrets,
  unconfiguredWebhookIsAllowed,
  verifyMatrixToken,
  verifyMetaSignature,
  verifyTeamsJwt,
} from './webhook-auth.js';

const APP_SECRET = 'meta-app-secret';

function metaSignature(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('Meta webhook signatures', () => {
  const body = JSON.stringify({ entry: [{ id: '1' }] });

  it('accepts a signature over the exact bytes sent', () => {
    expect(
      verifyMetaSignature({ rawBody: body, header: metaSignature(body), appSecret: APP_SECRET }),
    ).toEqual({ ok: true });
  });

  it('rejects a body altered after signing', () => {
    const header = metaSignature(body);
    const tampered = JSON.stringify({ entry: [{ id: '2' }] });

    expect(verifyMetaSignature({ rawBody: tampered, header, appSecret: APP_SECRET }).ok).toBe(
      false,
    );
  });

  it('rejects a signature made with a different secret', () => {
    const header = metaSignature(body, 'not-the-app-secret');

    expect(verifyMetaSignature({ rawBody: body, header, appSecret: APP_SECRET }).ok).toBe(false);
  });

  it('refuses when the raw body was not captured', () => {
    // Verifying against `JSON.stringify(req.body)` would compare a
    // re-serialisation against a hash of the original bytes — differing on key
    // order or escaping — so a missing raw body must fail, never fall back.
    const verdict = verifyMetaSignature({
      rawBody: undefined,
      header: metaSignature(body),
      appSecret: APP_SECRET,
    });

    expect(verdict).toEqual({ ok: false, reason: 'raw body unavailable' });
  });

  it('rejects a missing or malformed header', () => {
    expect(
      verifyMetaSignature({ rawBody: body, header: undefined, appSecret: APP_SECRET }).ok,
    ).toBe(false);
    expect(
      verifyMetaSignature({ rawBody: body, header: 'sha1=abcd', appSecret: APP_SECRET }).ok,
    ).toBe(false);
  });

  it('refuses when no app secret is configured', () => {
    expect(
      verifyMetaSignature({ rawBody: body, header: metaSignature(body), appSecret: '' }),
    ).toEqual({ ok: false, reason: 'no app secret configured' });
  });
});

describe('Matrix as_token', () => {
  const asToken = 'as-token-from-the-registration-file';

  it('accepts the bearer form', () => {
    expect(
      verifyMatrixToken({
        authorization: `Bearer ${asToken}`,
        queryToken: undefined,
        asToken,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts the legacy query form', () => {
    expect(verifyMatrixToken({ authorization: undefined, queryToken: asToken, asToken })).toEqual({
      ok: true,
    });
  });

  it('rejects a wrong token', () => {
    expect(
      verifyMatrixToken({ authorization: 'Bearer nope', queryToken: undefined, asToken }).ok,
    ).toBe(false);
  });

  it('rejects a token that only shares a prefix', () => {
    // A prefix comparison would accept this; the check is a full constant-time
    // equality over equal-length buffers.
    expect(
      verifyMatrixToken({
        authorization: `Bearer ${asToken.slice(0, 10)}`,
        queryToken: undefined,
        asToken,
      }).ok,
    ).toBe(false);
  });

  it('refuses when no as_token is configured', () => {
    expect(
      verifyMatrixToken({ authorization: `Bearer ${asToken}`, queryToken: undefined, asToken: '' }),
    ).toEqual({ ok: false, reason: 'no as_token configured' });
  });
});

/* ---------------- Bot Framework JWT ---------------- */

const APP_ID = '11111111-2222-3333-4444-555555555555';
const KID = 'test-key-1';

function keypair(): { privateKey: KeyObject; jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' },
  };
}

function sign(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: KID },
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

const NOW = 1_800_000_000;

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: BOT_FRAMEWORK_ISSUER,
    aud: APP_ID,
    exp: NOW + 300,
    nbf: NOW - 60,
    serviceurl: 'https://smba.trafficmanager.net/teams/',
    ...overrides,
  };
}

function jwksOf(jwk: Record<string, unknown>) {
  return { keys: async () => [jwk] };
}

describe('Bot Framework JWT', () => {
  it('accepts a token Microsoft actually signed', async () => {
    const { privateKey, jwk } = keypair();

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${sign(privateKey, validClaims())}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
    });

    expect(verdict).toEqual({ ok: true });
  });

  it('rejects a token signed by someone else', async () => {
    // The whole point. Claims are trivially forgeable; only the signature is not.
    const { jwk } = keypair();
    const attacker = keypair();

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${sign(attacker.privateKey, validClaims())}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
    });

    expect(verdict).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('rejects alg: none', async () => {
    const { privateKey, jwk } = keypair();
    const token = sign(privateKey, validClaims(), { alg: 'none', kid: KID });

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${token}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
    });

    // The algorithm is pinned rather than read from the token, so this is
    // refused before any key is even looked up.
    expect(verdict).toEqual({ ok: false, reason: 'unexpected alg: none' });
  });

  it('rejects a validly signed token minted for a different bot', async () => {
    // Microsoft signs tokens for every Bot Framework bot with the same keys. A
    // signature check alone would let any of them post here.
    const { privateKey, jwk } = keypair();
    const token = sign(privateKey, validClaims({ aud: 'some-other-bot-app-id-0000-000000000000' }));

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${token}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
    });

    expect(verdict).toEqual({ ok: false, reason: 'token issued for a different application' });
  });

  it('rejects a wrong issuer', async () => {
    const { privateKey, jwk } = keypair();
    const token = sign(privateKey, validClaims({ iss: 'https://evil.example' }));

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${token}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
    });

    expect(verdict.ok).toBe(false);
  });

  it('rejects an expired token and one not yet valid', async () => {
    const { privateKey, jwk } = keypair();
    const jwks = jwksOf(jwk);

    const expired = await verifyTeamsJwt({
      authorization: `Bearer ${sign(privateKey, validClaims({ exp: NOW - 1 }))}`,
      appId: APP_ID,
      jwks,
      now: NOW,
    });
    const early = await verifyTeamsJwt({
      authorization: `Bearer ${sign(privateKey, validClaims({ nbf: NOW + 120 }))}`,
      appId: APP_ID,
      jwks,
      now: NOW,
    });

    expect(expired).toEqual({ ok: false, reason: 'token expired' });
    expect(early).toEqual({ ok: false, reason: 'token not yet valid' });
  });

  it('rejects a token replayed against a different serviceUrl', async () => {
    const { privateKey, jwk } = keypair();

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${sign(privateKey, validClaims())}`,
      appId: APP_ID,
      jwks: jwksOf(jwk),
      now: NOW,
      serviceUrl: 'https://attacker.example/',
    });

    expect(verdict).toEqual({ ok: false, reason: 'serviceUrl does not match the token' });
  });

  it('refetches keys once when the token names an unknown kid', async () => {
    // Microsoft rotates signing keys. A cache older than the rotation would
    // reject legitimate traffic until it expired on its own.
    const { privateKey, jwk } = keypair();
    const rotated = { ...jwk, kid: 'rotated-key' };
    const keys = vi
      .fn<(options?: { force?: boolean }) => Promise<Record<string, unknown>[]>>()
      .mockResolvedValueOnce([{ kid: 'stale-key', kty: 'RSA' }])
      .mockResolvedValueOnce([rotated]);

    const verdict = await verifyTeamsJwt({
      authorization: `Bearer ${sign(privateKey, validClaims(), { alg: 'RS256', kid: 'rotated-key' })}`,
      appId: APP_ID,
      jwks: { keys },
      now: NOW,
    });

    expect(verdict).toEqual({ ok: true });
    expect(keys).toHaveBeenCalledTimes(2);
    expect(keys.mock.calls[1]?.[0]).toEqual({ force: true });
  });

  it('rejects a malformed token without throwing', async () => {
    const { jwk } = keypair();
    for (const authorization of [undefined, 'Bearer not.a.jwt', 'Bearer onlyonepart', 'Basic x']) {
      const verdict = await verifyTeamsJwt({
        authorization,
        appId: APP_ID,
        jwks: jwksOf(jwk),
        now: NOW,
      });
      expect(verdict.ok, `accepted ${String(authorization)}`).toBe(false);
    }
  });
});

describe('JWKS source', () => {
  function stubFetch(jwksUri: string, keys: unknown[]) {
    return vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      const body = href === BOT_FRAMEWORK_OPENID_URL ? { jwks_uri: jwksUri } : { keys };
      return { ok: true, status: 200, json: async () => body } as Response;
    });
  }

  it('discovers jwks_uri from the metadata document and caches the result', async () => {
    const fetchImpl = stubFetch('https://login.botframework.com/v1/.well-known/keys', [
      { kid: 'a' },
    ]);
    const jwks = createBotFrameworkJwks({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await jwks.keys()).toEqual([{ kid: 'a' }]);
    await jwks.keys();

    // Two calls for the first read (metadata, then keys), none for the second.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(BOT_FRAMEWORK_OPENID_URL);
  });

  it('refetches when forced', async () => {
    const fetchImpl = stubFetch('https://login.botframework.com/v1/.well-known/keys', [
      { kid: 'a' },
    ]);
    const jwks = createBotFrameworkJwks({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });

    await jwks.keys();
    await jwks.keys({ force: true });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws rather than returning no keys when the endpoint fails', async () => {
    // A caller that saw an empty key set would report "signing key not
    // published" — a 401 blaming the sender for an outage on our side.
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const jwks = createBotFrameworkJwks({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(jwks.keys()).rejects.toThrow(/503/);
  });
});

describe('policy for an unconfigured webhook', () => {
  it('fails closed unless the deployment has declared itself insecure', () => {
    expect(unconfiguredWebhookIsAllowed({})).toBe(false);
    expect(unconfiguredWebhookIsAllowed({ ANVIO_API_ALLOW_INSECURE: 'false' })).toBe(false);
    // Reuses ADR-0018's flag: an operator who already declared this deployment's
    // surface unauthenticated has made the same choice once.
    expect(unconfiguredWebhookIsAllowed({ ANVIO_API_ALLOW_INSECURE: 'true' })).toBe(true);
  });

  it('keeps the inbound Matrix token separate from the outbound one', () => {
    // MATRIX_ACCESS_TOKEN is what Anvio presents to the homeserver; MATRIX_AS_TOKEN
    // is what the homeserver presents here. One name for both would invite reuse.
    const secrets = resolveWebhookSecrets({
      MATRIX_ACCESS_TOKEN: 'outbound',
      MATRIX_AS_TOKEN: 'inbound',
    });

    expect(secrets.matrixAsToken).toBe('inbound');
  });

  it('reports every secret as empty when nothing is configured', () => {
    expect(resolveWebhookSecrets({})).toEqual({
      whatsappAppSecret: '',
      matrixAsToken: '',
      teamsAppId: '',
    });
  });
});
