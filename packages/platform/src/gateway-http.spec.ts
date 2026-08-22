import { createHmac } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGatewayHttp } from './gateway-http.js';
import type { PlatformContext } from './platform-context.js';

/**
 * The gateway serves the same routes as `apps/api` from a second, hand-rolled
 * implementation, and every hardening decision made for `apps/api` had to be
 * made again here (issue #42). These tests exist so the two cannot drift a third
 * time without something going red.
 */

function request(options: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const stream = new PassThrough();
  stream.end(options.body ?? '');
  const req = stream as unknown as IncomingMessage;
  req.method = options.method;
  req.url = options.url;
  req.headers = options.headers ?? {};
  return req;
}

function response() {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(chunk?: string) {
      captured.body = chunk ?? '';
      return res;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

function platformWith(overrides: Partial<PlatformContext> = {}): PlatformContext {
  return {
    auth: {
      enabled: false,
      getDefaultContext: () => ({ userId: 'local-user' }),
      authenticate: async () => null,
    },
    channelHub: { getAdapter: () => undefined },
    whatsapp: undefined,
    workspace: { config: { spec: { storage: { provider: 'filesystem' } } } },
    ...overrides,
  } as unknown as PlatformContext;
}

const ENV = { ...process.env };

beforeEach(() => {
  for (const key of [
    'MATRIX_AS_TOKEN',
    'TEAMS_APP_ID',
    'WHATSAPP_APP_SECRET',
    'ANVIO_API_ALLOW_INSECURE',
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('gateway authentication', () => {
  it('refuses a bad token instead of falling back to the default context', async () => {
    // The defect ADR-0018 removed from sessions.controller.ts and left standing
    // here: `authenticate()` returning null resolved to getDefaultContext(), so
    // enabling auth added a lock that opened when jiggled.
    const authenticate = vi.fn(async () => null);
    const getDefaultContext = vi.fn(() => ({ userId: 'local-user' }));
    const platform = platformWith({
      auth: { enabled: true, authenticate, getDefaultContext },
    } as unknown as Partial<PlatformContext>);

    const { res, captured } = response();
    await handleGatewayHttp(
      platform,
      request({
        method: 'POST',
        url: '/api/sessions',
        body: JSON.stringify({ agentName: 'architect' }),
        headers: { authorization: 'Bearer forged' },
      }),
      res,
      '/api/sessions',
    );

    expect(captured.status).toBe(401);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(getDefaultContext, 'fell back to the default context').not.toHaveBeenCalled();
  });
});

describe('gateway channel webhooks', () => {
  const matrixBody = JSON.stringify({ roomId: '!r:e.org', senderId: '@u:e.org', body: 'hi' });

  async function post(url: string, body: string, headers: Record<string, string> = {}) {
    const { res, captured } = response();
    await handleGatewayHttp(
      platformWith(),
      request({ method: 'POST', url, body, headers }),
      res,
      url.split('?')[0]!,
    );
    return captured;
  }

  it('rejects a Matrix post with no as_token', async () => {
    process.env.MATRIX_AS_TOKEN = 'as-secret';

    const captured = await post('/api/channels/matrix/webhook', matrixBody);

    expect(captured.status).toBe(401);
  });

  it('rejects a Matrix post with the wrong as_token', async () => {
    process.env.MATRIX_AS_TOKEN = 'as-secret';

    const captured = await post('/api/channels/matrix/webhook', matrixBody, {
      authorization: 'Bearer wrong',
    });

    expect(captured.status).toBe(401);
  });

  it('accepts the legacy query form of the as_token', async () => {
    process.env.MATRIX_AS_TOKEN = 'as-secret';

    const captured = await post('/api/channels/matrix/webhook?access_token=as-secret', matrixBody);

    // 404 rather than 200: authentication passed and the unregistered adapter
    // was reached, which is the assertion — the auth gate did not stop it.
    expect(captured.status).toBe(404);
  });

  it('fails closed when nothing is configured', async () => {
    const captured = await post('/api/channels/matrix/webhook', matrixBody);

    expect(captured.status).toBe(401);
    expect(captured.body).toContain('MATRIX_AS_TOKEN');
  });

  it('honours the same insecure escape hatch as apps/api', async () => {
    // ADR-0021 D2: one flag, one meaning, across both surfaces.
    process.env.ANVIO_API_ALLOW_INSECURE = 'true';

    const captured = await post('/api/channels/matrix/webhook', matrixBody);

    expect(captured.status).toBe(404);
  });

  it('verifies the WhatsApp signature over the raw body', async () => {
    process.env.WHATSAPP_APP_SECRET = 'meta-secret';
    const body = JSON.stringify({ entry: [{ id: '1' }] });
    const signature = `sha256=${createHmac('sha256', 'meta-secret').update(body).digest('hex')}`;

    const forged = await post('/api/channels/whatsapp/webhook', body, {
      'x-hub-signature-256': 'sha256=deadbeef',
    });
    const valid = await post('/api/channels/whatsapp/webhook', body, {
      'x-hub-signature-256': signature,
    });

    expect(forged.status).toBe(401);
    // 404: the channel is not enabled in this fixture, so reaching it proves the
    // signature was accepted.
    expect(valid.status).toBe(404);
  });

  it('rejects a Teams post that carries no Bot Framework token', async () => {
    process.env.TEAMS_APP_ID = '1111-2222';

    const captured = await post('/api/channels/teams/webhook', JSON.stringify({ type: 'message' }));

    expect(captured.status).toBe(401);
  });
});
