import { AnvioError } from '@anvio/core';
import { startLoginHost } from '@anvio/harness';

export const NOUS_CONNECTION_SERVICE = 'nous';
export const DEFAULT_NOUS_PORTAL_URL = 'https://portal.nousresearch.com';

export interface NousSetupTokenOptions {
  /** Nous Portal base URL. Defaults to NOUS_PORTAL_URL env or the public portal. */
  portalUrl?: string;
  /** Local callback host port. Defaults to 9877. */
  port?: number;
  timeoutMs?: number;
  /** Paste a token obtained elsewhere (headless / CI) instead of running the browser flow. */
  explicitToken?: string;
  /** Called with the authorize URL the user should open, before waiting for the callback. */
  onAuthorizeUrl?: (url: string) => void;
}

function isMockMode(): boolean {
  return process.env.ANVIO_NOUS_MOCK === '1';
}

/**
 * Nous Portal OAuth — Hermes-style "1-click" login that grants access to
 * Nous-hosted models + tools via a single browser authorization instead of
 * per-provider API keys. Unlike Claude/Cursor/Codex/Antigravity, the portal
 * has no official CLI, so this drives a local OAuth callback host
 * (`@anvio/harness` `startLoginHost`) rather than spawning a vendor binary.
 *
 * Headless/CI: pass `explicitToken` (paste a token generated via the portal
 * UI elsewhere). Dev/test: set `ANVIO_NOUS_MOCK=1` to synthesize a token
 * without network access.
 */
export async function runNousSetupToken(
  options: NousSetupTokenOptions = {},
): Promise<{ payload: string; message: string }> {
  if (options.explicitToken?.trim()) {
    return {
      payload: JSON.stringify({
        authMethod: 'nous-token',
        accessToken: options.explicitToken.trim(),
        grantedAt: new Date().toISOString(),
      }),
      message: 'Nous Portal token saved manually (headless — paste token from the portal UI).',
    };
  }

  if (isMockMode()) {
    return {
      payload: JSON.stringify({
        authMethod: 'nous-portal-oauth',
        accessToken: `mock-nous-token-${Date.now()}`,
        grantedAt: new Date().toISOString(),
        mock: true,
      }),
      message: 'Nous Portal OAuth saved (ANVIO_NOUS_MOCK=1 — synthetic token for dev/test).',
    };
  }

  const portalUrl = (options.portalUrl ?? process.env.NOUS_PORTAL_URL ?? DEFAULT_NOUS_PORTAL_URL).replace(
    /\/$/,
    '',
  );
  const timeoutMs = options.timeoutMs ?? 300_000;
  const host = await startLoginHost({ port: options.port ?? 9877, timeoutMs });

  try {
    const authorizeUrl = `${portalUrl}/authorize?client=anvio&scope=model+tools&redirect_uri=${encodeURIComponent(
      host.callbackUrl,
    )}`;
    options.onAuthorizeUrl?.(authorizeUrl);

    const query = await host.waitForCallback();
    const token = query.token ?? query.access_token ?? query.code;
    if (!token) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        `Nous Portal callback did not include a token/access_token/code param: ${JSON.stringify(query)}`,
      );
    }

    return {
      payload: JSON.stringify({
        authMethod: 'nous-portal-oauth',
        accessToken: token,
        grantedAt: new Date().toISOString(),
        raw: query,
      }),
      message: 'Nous Portal OAuth saved — 1-click model + tools access (not per-provider API keys).',
    };
  } finally {
    await host.close();
  }
}

export function parseNousConnectionPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { accessToken?: string };
    if (parsed.accessToken?.trim()) return parsed.accessToken.trim();
    return null;
  } catch {
    return payload.trim() || null;
  }
}
