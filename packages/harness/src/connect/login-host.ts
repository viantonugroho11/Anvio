import http from 'node:http';

export interface LoginHostOptions {
  host?: string;
  port: number;
  callbackPath?: string;
  timeoutMs?: number;
}

export interface LoginHostSession {
  baseUrl: string;
  callbackUrl: string;
  waitForCallback: () => Promise<Record<string, string>>;
  close: () => Promise<void>;
}

/** Local OAuth callback host — captures grant query params for contextual connections. */
export async function startLoginHost(options: LoginHostOptions): Promise<LoginHostSession> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port;
  const callbackPath = options.callbackPath ?? '/connect/callback';
  const timeoutMs = options.timeoutMs ?? 120_000;

  let resolveCallback: ((query: Record<string, string>) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;

  const callbackPromise = new Promise<Record<string, string>>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const timer = setTimeout(() => {
    rejectCallback?.(new Error('Login host timed out waiting for callback'));
  }, timeoutMs);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    if (url.pathname !== callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!DOCTYPE html><html><body><h1>Connection saved</h1><p>You can close this window and return to Anvio.</p></body></html>',
    );

    clearTimeout(timer);
    resolveCallback?.(query);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const baseUrl = `http://${host}:${actualPort}`;

  return {
    baseUrl,
    callbackUrl: `${baseUrl}${callbackPath}`,
    waitForCallback: () => callbackPromise,
    close: async () => {
      clearTimeout(timer);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
