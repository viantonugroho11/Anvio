import http, { type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  EventSubjects,
  type AgentRunChunkData,
  type AgentRunCompletedData,
} from '@anvio/events';
import { WebChatChannel } from '@anvio/channels';
import { initObservability, shutdownObservability } from '@anvio/observability';
import { createPlatform } from './index.js';
import { registerGatewayWorker } from './gateway-worker.js';
import { handleGatewayHttp } from './gateway-http.js';

export interface UnifiedGatewayOptions {
  workspacePath?: string;
  port?: number;
  host?: string;
  anthropicApiKey?: string;
}

export interface UnifiedGatewayHandle {
  port: number;
  shutdown: () => Promise<void>;
}

const sessionClients = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, data: unknown): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/**
 * Hermes-style unified gateway: one process for channels, worker, REST API, and WebSocket.
 */
export async function startUnifiedGateway(
  options: UnifiedGatewayOptions = {},
): Promise<UnifiedGatewayHandle> {
  initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anvio-gateway',
    enabled: process.env.ANVIO_OTEL_ENABLED === 'true' || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const platform = await createPlatform({
    workspacePath: options.workspacePath ?? process.env.ANVIO_WORKSPACE,
    anthropicApiKey: options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  await registerGatewayWorker(platform);

  const webChat = new WebChatChannel();
  await webChat.start();

  await platform.eventBus.subscribeCore<AgentRunChunkData>(
    EventSubjects.AGENT_RUN_CHUNK,
    async (event) => {
      broadcastToSession(event.data.sessionId, {
        type: 'chunk',
        sessionId: event.data.sessionId,
        delta: event.data.delta,
      });
    },
  );

  await platform.eventBus.subscribeCore<AgentRunCompletedData>(
    EventSubjects.AGENT_RUN_COMPLETED,
    async (event) => {
      broadcastToSession(event.data.sessionId, {
        type: 'done',
        sessionId: event.data.sessionId,
        content: event.data.content,
        usage: event.data.usage,
      });
    },
  );

  const port = options.port ?? parseInt(process.env.ANVIO_GATEWAY_PORT ?? '3001', 10);
  const host = options.host ?? process.env.ANVIO_GATEWAY_HOST ?? '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const handled = await handleGatewayHttp(platform, req, res, url.pathname);
    if (!handled) {
      json(res, 404, { error: 'Not found' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') ?? undefined;
    const sessionId = url.searchParams.get('sessionId');

    if (platform.auth.enabled && !token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    if (!sessionId) {
      ws.close(4002, 'sessionId required');
      return;
    }

    if (!sessionClients.has(sessionId)) sessionClients.set(sessionId, new Set());
    sessionClients.get(sessionId)!.add(ws);
    webChat.registerClient(sessionId, { sessionId, send: (data) => ws.send(data) });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          sessionId: string;
          content: string;
        };
        if (msg.type === 'message' && msg.content) {
          const stored = await platform.workspace.sessions.get(sessionId);
          if (!stored) {
            ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
            return;
          }
          await platform.eventBus.publish(
            EventSubjects.AGENT_RUN_REQUESTED,
            'anvio.agent.run.requested',
            {
              sessionId,
              userId: stored.userId,
              agentId: stored.agentName,
              content: msg.content,
              channel: stored.channel,
              detached: stored.detached,
            },
          );
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      sessionClients.get(sessionId)?.delete(ws);
      webChat.unregisterClient(sessionId);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  const storage = platform.workspace.config.spec.storage.provider;
  console.log(`Anvio unified gateway on http://${host}:${port}`);
  console.log(`  REST API   /api/*`);
  console.log(`  WebSocket  /ws?sessionId=<id>`);
  console.log(`  Health     /health`);
  console.log(`  Sessions   ${storage} store · Channel Hub active · Cron/automation running`);

  const shutdown = async () => {
    await platform.channelHub.stopAll();
    await webChat.stop();
    await platform.eventBus.close();
    await platform.hookEngine.stop();
    await platform.automationEngine.stop();
    await shutdownObservability();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { port, shutdown };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
