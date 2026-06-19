import http from 'node:http';
import type {
  AcpHealthResponse,
  AcpPromptRequest,
  AcpPromptResponse,
  AcpRunHandler,
  AcpServerConfig,
  AcpServerStatus,
  AcpStreamHandler,
} from './protocol/messages.js';

export class AcpServer {
  private server: http.Server | null = null;
  private connections = 0;
  private actualPort: number;

  constructor(
    private readonly config: AcpServerConfig,
    private readonly onPrompt: AcpRunHandler,
    private readonly onStream?: AcpStreamHandler,
  ) {
    this.actualPort = config.port;
  }

  getPort(): number {
    return this.actualPort;
  }

  getStatus(): AcpServerStatus {
    return {
      running: this.server !== null,
      host: this.config.host,
      port: this.config.port,
      connections: this.connections,
    };
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;

    this.server = http.createServer((req, res) => {
      this.connections += 1;
      void this.handle(req, res).finally(() => {
        this.connections -= 1;
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => resolve());
      this.server!.on('error', reject);
    });

    const addr = this.server.address();
    this.actualPort = typeof addr === 'object' && addr ? addr.port : this.config.port;
    return this.actualPort;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      srv.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/health') {
      const body: AcpHealthResponse = {
        status: 'ok',
        version: '1.0.0',
        protocol: 'anvio-acp/v1',
      };
      this.json(res, 200, body);
      return;
    }

    if (req.method === 'POST' && url === '/prompt/stream') {
      if (!this.onStream) {
        this.json(res, 501, { error: 'Streaming not configured' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        const payload = (await readJson(req)) as AcpPromptRequest;
        const result = await this.onStream(payload, (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        res.write(`data: ${JSON.stringify({ type: 'done', sessionId: result.sessionId, status: result.status })}\n\n`);
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
        res.end();
      }
      return;
    }

    if (req.method === 'POST' && url === '/prompt') {
      try {
        const payload = (await readJson(req)) as AcpPromptRequest;
        if (!payload.agent || !payload.message) {
          this.json(res, 400, { error: 'agent and message are required' });
          return;
        }
        const result = await this.onPrompt(payload);
        this.json(res, 200, result satisfies AcpPromptResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.json(res, 500, { error: message });
      }
      return;
    }

    this.json(res, 404, { error: 'Not found' });
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

export function createAcpServer(
  config: AcpServerConfig,
  onPrompt: AcpRunHandler,
  onStream?: AcpStreamHandler,
): AcpServer {
  return new AcpServer(config, onPrompt, onStream);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
