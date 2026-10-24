import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_EGRESS_POLICY,
  assertEgressAllowed,
  guardedFetch,
  isPrivateAddress,
  readBodyCapped,
} from './egress.js';
import { httpRequest } from './network-tools.js';
import { webFetch } from './web-fetch.js';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(50_000));
      return;
    }
    if (req.url === '/redirect-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (req.url === '/redirect-local') {
      res.writeHead(302, { location: '/hello' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>hello</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const allowLocal = { ...DEFAULT_EGRESS_POLICY, allowHosts: ['127.0.0.1'] };

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('assertEgressAllowed', () => {
  it('refuses non-http schemes', async () => {
    await expect(assertEgressAllowed('file:///etc/passwd', DEFAULT_EGRESS_POLICY)).rejects.toThrow(
      /http and https/,
    );
  });

  it('refuses loopback and metadata literals by default', async () => {
    await expect(
      assertEgressAllowed('http://127.0.0.1:3000/api', DEFAULT_EGRESS_POLICY),
    ).rejects.toThrow(/private/);
    await expect(assertEgressAllowed('http://[::1]/', DEFAULT_EGRESS_POLICY)).rejects.toThrow(
      /private/,
    );
    await expect(
      assertEgressAllowed('http://169.254.169.254/', DEFAULT_EGRESS_POLICY),
    ).rejects.toThrow(/private/);
  });

  it('refuses hostnames that resolve to loopback', async () => {
    await expect(
      assertEgressAllowed('http://localhost:3000/', DEFAULT_EGRESS_POLICY),
    ).rejects.toThrow(/private/);
  });

  it('allows listed hosts and the private-network opt-in', async () => {
    await expect(assertEgressAllowed('http://127.0.0.1/', allowLocal)).resolves.toBeUndefined();
    await expect(
      assertEgressAllowed('http://10.0.0.1/', {
        ...DEFAULT_EGRESS_POLICY,
        allowPrivateNetwork: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('guardedFetch', () => {
  it('re-checks every redirect hop', async () => {
    await expect(guardedFetch(`${base}/redirect-metadata`, {}, allowLocal)).rejects.toThrow(
      /169\.254\.169\.254/,
    );
  });

  it('follows allowed redirects', async () => {
    const { response, finalUrl } = await guardedFetch(`${base}/redirect-local`, {}, allowLocal);
    expect(response.status).toBe(200);
    expect(finalUrl).toBe(`${base}/hello`);
  });
});

describe('readBodyCapped', () => {
  it('stops reading at the byte cap', async () => {
    const { response } = await guardedFetch(`${base}/big`, {}, allowLocal);
    const { text, truncated } = await readBodyCapped(response, 1_000);
    expect(text.length).toBe(1_000);
    expect(truncated).toBe(true);
  });

  it('reports untruncated bodies', async () => {
    const { response } = await guardedFetch(`${base}/hello`, {}, allowLocal);
    expect(await readBodyCapped(response, 1_000)).toEqual({
      text: '<p>hello</p>',
      truncated: false,
    });
  });
});

describe('network tools', () => {
  it('web_fetch fails instead of fetching a loopback URL', async () => {
    const result = await webFetch(`${base}/hello`);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/private/);
  });

  it('http_request honours allowHosts and caps the body', async () => {
    const out = await httpRequest(
      { url: `${base}/big` },
      { ...allowLocal, maxResponseBytes: 2_000 },
    );
    expect(out.status).toBe(200);
    expect(out.body.length).toBe(2_000);
  });
});
