import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';

/**
 * Verification for the channel webhooks that sit outside `AnvioAuthGuard`.
 *
 * ADR-0018 D5 marked these `@Public()` because Meta, Microsoft, and a Matrix
 * homeserver post to them and none can present a user bearer token. `@Public()`
 * recorded that they are outside the guard model — it never claimed they were
 * safe, and only WhatsApp verified anything at all, on the GET handshake only.
 * Each provider authenticates by its own mechanism, so each needs its own check.
 *
 * Every function here is pure apart from the JWKS fetch, which is injected.
 */

export type WebhookVerdict = { ok: true } | { ok: false; reason: string };

function deny(reason: string): WebhookVerdict {
  return { ok: false, reason };
}

/**
 * Constant-time comparison that tolerates different lengths.
 *
 * `timingSafeEqual` throws on a length mismatch, so a naive wrapper leaks the
 * comparison outcome through an exception. Length itself is not secret here —
 * an attacker can already see the shape of a signature header — but *which*
 * bytes differ must not be observable.
 */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ *
 * Meta / WhatsApp — X-Hub-Signature-256
 * ------------------------------------------------------------------ */

export interface MetaSignatureInput {
  /** Exact bytes Meta signed. A re-serialised object will not match. */
  rawBody: Buffer | string | undefined;
  /** Value of the `X-Hub-Signature-256` header. */
  header: string | undefined;
  appSecret: string;
}

/**
 * Meta signs the raw request body with the app secret and sends
 * `X-Hub-Signature-256: sha256=<hex>`.
 *
 * The raw bytes are load-bearing. `JSON.stringify(req.body)` round-trips through
 * the parser and will differ from what Meta hashed on key order, unicode
 * escaping, or whitespace — so this takes the buffer captured before parsing and
 * refuses outright if it is missing, rather than silently verifying a
 * reconstruction that would fail for reasons unrelated to authenticity.
 */
export function verifyMetaSignature(input: MetaSignatureInput): WebhookVerdict {
  if (!input.appSecret) return deny('no app secret configured');
  if (input.rawBody === undefined) return deny('raw body unavailable');
  if (!input.header) return deny('missing X-Hub-Signature-256');

  const [scheme, provided] = input.header.split('=', 2);
  if (scheme !== 'sha256' || !provided) return deny('malformed X-Hub-Signature-256');

  const expected = createHmac('sha256', input.appSecret).update(input.rawBody).digest('hex');
  return secretsMatch(expected, provided.toLowerCase()) ? { ok: true } : deny('signature mismatch');
}

/* ------------------------------------------------------------------ *
 * Matrix — application service as_token
 * ------------------------------------------------------------------ */

export interface MatrixTokenInput {
  authorization: string | undefined;
  /** Legacy `?access_token=` form, still sent by older homeservers. */
  queryToken: string | undefined;
  asToken: string;
}

/**
 * A Matrix homeserver authenticates to an application service with the
 * `as_token` from the registration file — as `Authorization: Bearer <token>`,
 * or as an `access_token` query parameter on older homeservers.
 *
 * Both forms are accepted because refusing the legacy one would break working
 * deployments to gain nothing: it is the same secret over the same channel.
 */
export function verifyMatrixToken(input: MatrixTokenInput): WebhookVerdict {
  if (!input.asToken) return deny('no as_token configured');

  const bearer = input.authorization?.startsWith('Bearer ')
    ? input.authorization.slice('Bearer '.length)
    : undefined;
  const presented = bearer ?? input.queryToken;
  if (!presented) return deny('missing as_token');

  return secretsMatch(input.asToken, presented) ? { ok: true } : deny('as_token mismatch');
}

/* ------------------------------------------------------------------ *
 * Teams — Bot Framework JWT
 * ------------------------------------------------------------------ */

/** Bot Framework's OpenID metadata document for channel-originated traffic. */
export const BOT_FRAMEWORK_OPENID_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';

/** The only issuer Bot Framework channel tokens carry. */
export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';

interface Jwk {
  kid?: string;
  kty?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface JwksSource {
  /** Returns the current signing keys. Implementations should cache. */
  keys(options?: { force?: boolean }): Promise<Jwk[]>;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export interface TeamsJwtInput {
  /** Value of the `Authorization` header, including the `Bearer ` prefix. */
  authorization: string | undefined;
  /** The bot's Microsoft app id; the token's `aud` must equal it. */
  appId: string;
  jwks: JwksSource;
  /** Seconds since epoch; injected so expiry can be tested without faking time. */
  now: number;
  /** `serviceUrl` from the activity body, checked against the claim when present. */
  serviceUrl?: string;
}

/**
 * Validates a Bot Framework token: RS256 signature against Microsoft's published
 * keys, then issuer, audience, and validity window.
 *
 * Signature verification is the whole point. Reading `aud` and `iss` off an
 * unverified token proves nothing — anyone can mint a JWT claiming to be
 * Microsoft — so the claim checks below are only meaningful after the signature
 * has been confirmed, and they run in that order.
 *
 * Implemented on `node:crypto` rather than a JWT library: Node can build a
 * public key straight from a JWK and verify RS256 directly, so the alternative
 * was two dependencies in `apps/api` for about sixty lines of work.
 */
export async function verifyTeamsJwt(input: TeamsJwtInput): Promise<WebhookVerdict> {
  if (!input.appId) return deny('no Microsoft app id configured');
  if (!input.authorization?.startsWith('Bearer ')) return deny('missing bearer token');

  const token = input.authorization.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 3) return deny('malformed token');
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string; exp?: number; nbf?: number; serviceurl?: string };
  try {
    header = decodeSegment(headerSegment) as typeof header;
    claims = decodeSegment(payloadSegment) as typeof claims;
  } catch {
    return deny('undecodable token');
  }

  // Pinned, not read from the token. Accepting the token's own `alg` is how
  // `alg: none` and HS256-signed-with-the-public-key forgeries get in.
  if (header.alg !== 'RS256') return deny(`unexpected alg: ${String(header.alg)}`);
  if (!header.kid) return deny('token names no key');

  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8');
  const signature = Buffer.from(signatureSegment, 'base64url');

  // Microsoft rotates signing keys, and a cache older than the rotation would
  // reject legitimate traffic. An unknown kid is the signal to refetch once.
  let keys = await input.jwks.keys();
  let jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    keys = await input.jwks.keys({ force: true });
    jwk = keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!jwk) return deny('signing key not published');

  let verified = false;
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    verified = verifySignature('RSA-SHA256', signed, key, signature);
  } catch {
    return deny('signature could not be checked');
  }
  if (!verified) return deny('bad signature');

  if (claims.iss !== BOT_FRAMEWORK_ISSUER) return deny(`unexpected issuer: ${String(claims.iss)}`);
  if (!claims.aud || !secretsMatch(input.appId, claims.aud)) {
    // A token minted for a different bot is validly signed by Microsoft. Without
    // this check any Bot Framework bot could post to this endpoint.
    return deny('token issued for a different application');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= input.now) return deny('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > input.now) return deny('token not yet valid');

  // Bot Framework binds the callback host into the token. A mismatch means the
  // token was minted for a different bot endpoint and replayed here.
  if (input.serviceUrl && claims.serviceurl && claims.serviceurl !== input.serviceUrl) {
    return deny('serviceUrl does not match the token');
  }

  return { ok: true };
}

/**
 * JWKS reader with a TTL cache.
 *
 * Fetches the OpenID metadata to discover `jwks_uri` rather than hardcoding it,
 * because that indirection is the whole point of the metadata document — the key
 * endpoint is Microsoft's to move.
 */
export function createBotFrameworkJwks(options?: {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}): JwksSource {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = options?.now ?? Date.now;

  let cached: Jwk[] | null = null;
  let fetchedAt = 0;

  return {
    async keys(callOptions): Promise<Jwk[]> {
      if (cached && !callOptions?.force && now() - fetchedAt < ttlMs) return cached;

      const metadataResponse = await fetchImpl(BOT_FRAMEWORK_OPENID_URL);
      if (!metadataResponse.ok) {
        throw new Error(`Bot Framework metadata: HTTP ${metadataResponse.status}`);
      }
      const metadata = (await metadataResponse.json()) as { jwks_uri?: string };
      if (!metadata.jwks_uri) throw new Error('Bot Framework metadata has no jwks_uri');

      const keysResponse = await fetchImpl(metadata.jwks_uri);
      if (!keysResponse.ok) throw new Error(`Bot Framework JWKS: HTTP ${keysResponse.status}`);
      const document = (await keysResponse.json()) as { keys?: Jwk[] };

      cached = document.keys ?? [];
      fetchedAt = now();
      return cached;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

/**
 * What to do when a webhook has no secret configured at all.
 *
 * Fail closed. An endpoint that cannot verify its caller and accepts anyway is
 * the bug this module exists to fix, and the operator who has not configured a
 * secret is exactly the one who will not notice.
 *
 * The escape hatch is `ANVIO_API_ALLOW_INSECURE`, reused rather than duplicated:
 * ADR-0018 already defines it as "this deployment accepts an unauthenticated
 * surface", which is the same declaration. Anyone who set it to expose an
 * unauthenticated API off loopback has already made this choice explicitly, and
 * a second knob would only let the two drift apart.
 */
export function unconfiguredWebhookIsAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.ANVIO_API_ALLOW_INSECURE === 'true';
}

export interface WebhookSecrets {
  /** Meta app secret used to sign `X-Hub-Signature-256`. */
  whatsappAppSecret: string;
  /** Matrix application-service `as_token` from the registration file. */
  matrixAsToken: string;
  /** Microsoft app id; a Bot Framework token's `aud` must equal it. */
  teamsAppId: string;
}

/**
 * Follows the `WHATSAPP_*` / `MATRIX_*` / `TEAMS_*` naming the channel package
 * already uses.
 *
 * `MATRIX_AS_TOKEN` is deliberately not `MATRIX_ACCESS_TOKEN`. The existing
 * variable is the token Anvio presents when calling *out* to the homeserver;
 * this is the one the homeserver presents when calling *in*. They are different
 * secrets flowing in opposite directions, and collapsing them into one name
 * would invite an operator to reuse a single value for both.
 */
export function resolveWebhookSecrets(env: NodeJS.ProcessEnv): WebhookSecrets {
  return {
    whatsappAppSecret: env.WHATSAPP_APP_SECRET ?? '',
    matrixAsToken: env.MATRIX_AS_TOKEN ?? '',
    teamsAppId: env.TEAMS_APP_ID ?? '',
  };
}
