import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startUnifiedGateway, type UnifiedGatewayHandle } from '@anvio/platform';

/**
 * The boot smoke tests ADR-0020 and ADR-0022 both recorded as missing.
 *
 * Two bugs shipped in ADR-0018 meant `apps/api` did not start at all while 29
 * unit tests passed — they exercise `security.ts` and `auth.guard.ts` as pure
 * units, correctly, and uselessly for a fault in bootstrap ordering. A third,
 * in ADR-0021, left one webhook answering `404 channel not enabled` to a wholly
 * unauthenticated request while 26 tests passed. All three were found by
 * running the thing and none by testing it.
 *
 * **`apps/api` is booted as a child process against its built `dist`, on
 * purpose.** Booting `AppModule` in-process under vitest does not reproduce the
 * app that ships: vitest transpiles with esbuild, which does not emit
 * `emitDecoratorMetadata`, so Nest cannot resolve `Reflector` from the guard's
 * constructor and injects `undefined` — every guarded route then 500s. The
 * shipped build is compiled by `tsc` and works. A boot test that runs against a
 * differently-compiled app tests something other than what ships, and this one
 * produced a false failure before it was moved out of process.
 *
 * The gateway has no decorators, so it boots in-process from the same package
 * the CLI uses.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const API_ENTRY = path.join(REPO_ROOT, 'apps/api/dist/main.js');
const REPO_WORKSPACE = path.join(REPO_ROOT, 'workspace');

/** Ports chosen high and specific to this file to avoid a developer's running instance. */
const API_PORT = 3921;
const GATEWAY_PORT = 3922;

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`nothing answered ${url} within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/* ------------------------------------------------------------------ *
 * apps/api — booted from dist, as shipped
 * ------------------------------------------------------------------ */

describe('apps/api boots and serves', () => {
  let api: ChildProcess;
  let output = '';
  const base = `http://127.0.0.1:${API_PORT}`;

  beforeAll(async () => {
    // Fail loudly rather than skipping. A boot test that quietly passes when
    // there is nothing to boot is worse than no boot test.
    expect(
      existsSync(API_ENTRY),
      `${API_ENTRY} is missing — run \`pnpm build\` before the integration tests`,
    ).toBe(true);

    api = spawn(process.execPath, [API_ENTRY], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ANVIO_WORKSPACE: REPO_WORKSPACE,
        API_PORT: String(API_PORT),
        API_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    api.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    await waitForHttp(`${base}/api/health`);
  }, 60_000);

  afterAll(() => {
    api?.kill('SIGTERM');
  });

  it('answers under the /api prefix', async () => {
    // Bug two of ADR-0018: `setGlobalPrefix` ran after `init()`, which is a
    // no-op, so every route mounted bare and the whole API 404'd.
    const response = await fetch(`${base}/api/health`);

    expect(response.status).toBe(200);
  });

  it('does not answer without the prefix', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(404);
  });

  it('reached listen(), which means the platform resolved', async () => {
    // Bug one: `app.get(AppService)` ran before `init()`, so `platform` was
    // undefined and bootstrap threw before the port ever opened. The banner is
    // printed after `assertSafeBinding` and `listen()` both succeed.
    expect(output).toMatch(/API listening on 127\.0\.0\.1:/);
  });

  it('refuses an unverified channel webhook', async () => {
    // ADR-0021, and the ordering fix in D7: this must not report whether the
    // channel is configured to a caller who has not authenticated.
    const response = await fetch(`${base}/api/channels/matrix/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId: '!r:e.org', senderId: '@u:e.org', body: 'hi' }),
    });

    expect(response.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ *
 * gateway — the second surface, in-process
 * ------------------------------------------------------------------ */

describe('unified gateway boots and serves', () => {
  let gateway: UnifiedGatewayHandle;
  const base = `http://127.0.0.1:${GATEWAY_PORT}`;

  beforeAll(async () => {
    process.env.ANVIO_WORKSPACE = REPO_WORKSPACE;
    delete process.env.ANVIO_API_ALLOW_INSECURE;
    delete process.env.MATRIX_AS_TOKEN;
    process.env.WHATSAPP_APP_SECRET = 'boot-test-secret';

    gateway = await startUnifiedGateway({ port: GATEWAY_PORT, host: '127.0.0.1' });
    await waitForHttp(`${base}/health`);
  }, 60_000);

  afterAll(async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    await gateway?.shutdown();
  });

  it('serves health', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
  });

  it('refuses an unverified Matrix webhook', async () => {
    // ADR-0022: this endpoint accepted anything from anyone, because ADR-0021
    // only reached `apps/api`.
    const response = await fetch(`${base}/api/channels/matrix/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId: '!r:e.org', senderId: '@u:e.org', body: 'hi' }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects a forged WhatsApp signature and accepts a real one', async () => {
    const body = JSON.stringify({ entry: [{ id: '1' }] });
    const signature = `sha256=${createHmac('sha256', 'boot-test-secret').update(body).digest('hex')}`;
    const post = (header: string) =>
      fetch(`${base}/api/channels/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': header },
        body,
      });

    const forged = await post('sha256=deadbeef');
    const valid = await post(signature);

    expect(forged.status).toBe(401);
    // Not 200: the channel is not enabled in this workspace. Reaching that
    // answer is the assertion — the signature was accepted.
    expect(valid.status).toBe(404);
  });

  it('refuses to open a port that would be unauthenticated and reachable', async () => {
    // ADR-0018's rule, which the gateway ignored until ADR-0022. Auth is
    // disabled in the repo workspace, so a non-loopback host must be refused.
    await expect(startUnifiedGateway({ port: GATEWAY_PORT + 1, host: '0.0.0.0' })).rejects.toThrow(
      /Refusing to start/,
    );
  }, 60_000);
});
