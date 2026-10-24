import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { ToolGatewaySpec } from '@anvio/core';

export type EgressPolicy = ToolGatewaySpec['network'];

export const DEFAULT_EGRESS_POLICY: EgressPolicy = {
  allowPrivateNetwork: false,
  allowHosts: [],
  maxResponseBytes: 2_000_000,
};

const MAX_REDIRECTS = 5;

/** A timeout signal that also fires when the caller's run is cancelled. */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export class EgressDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressDeniedError';
  }
}

/**
 * `fetch` for URLs chosen by a model. Before this guard, `web_fetch` and
 * `http_request` would request any URL — including the loopback gateway API and
 * cloud metadata endpoints — so one prompt-injected page could drive requests
 * into the host's network (audit CQ-002).
 *
 * Redirects are followed manually so every hop is checked, and the response body
 * is read with a byte cap instead of buffering whatever the server sends.
 *
 * Known limit: the hostname is resolved here and again by `fetch`, so a DNS server
 * that answers differently between the two lookups can still reach a private
 * address. Closing that needs a pinned-IP dispatcher.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertEgressAllowed(current, policy);
    const response = await fetch(current, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).toString();
      if (switchesToGet(response.status, init.method)) {
        init = { ...init, method: 'GET', body: undefined };
      }
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new EgressDeniedError(`Too many redirects (>${MAX_REDIRECTS}) starting at ${url}`);
}

/** 303 always, and 301/302 for non-GET requests (fetch-spec behaviour), become a bodyless GET. */
function switchesToGet(status: number, method = 'GET'): boolean {
  const upper = method.toUpperCase();
  if (status === 303) return upper !== 'HEAD';
  return (status === 301 || status === 302) && upper === 'POST';
}

/** Read at most `maxBytes` of the body; the rest is discarded and the stream cancelled. */
export async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString('utf-8'), truncated };
}

export async function assertEgressAllowed(rawUrl: string, policy: EgressPolicy): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EgressDeniedError(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new EgressDeniedError(`Only http and https URLs are allowed (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (policy.allowHosts.some((allowed) => allowed.toLowerCase() === host)) return;
  if (policy.allowPrivateNetwork) return;

  const addresses = net.isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new EgressDeniedError(
        `Refusing to fetch ${parsed.host}: it resolves to a private or loopback address (${address}). ` +
          'Add the host to network.allowHosts in tools/gateway.yaml if this is intended.',
      );
    }
  }
}

/** Loopback, unspecified, private, CGNAT, link-local (incl. cloud metadata), multicast, reserved. */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIPv4(address);
  if (!net.isIPv6(address)) return true;
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  if (lower === '::' || lower === '::1') return true;
  const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
