import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { WebChatChannel } from '@anvio/channels';
import {
  EventSubjects,
  type AgentRunChunkData,
  type AgentRunCompletedData,
} from '@anvio/events';
import { createPlatform } from '@anvio/platform';

const sessionClients = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, data: unknown): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

async function main() {
  const platform = await createPlatform({
    workspacePath: process.env.ANVIO_WORKSPACE,
  });
  const { auth, eventBus } = platform;
  const port = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

  const webChat = new WebChatChannel();
  await webChat.start();

  await eventBus.subscribeCore<AgentRunChunkData>(
    EventSubjects.AGENT_RUN_CHUNK,
    async (event) => {
      broadcastToSession(event.data.sessionId, {
        type: 'chunk',
        sessionId: event.data.sessionId,
        delta: event.data.delta,
      });
    },
  );

  await eventBus.subscribeCore<AgentRunCompletedData>(
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

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'anvio-gateway', auth: auth.enabled }));
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') ?? undefined;
    const sessionId = url.searchParams.get('sessionId');

    if (auth.enabled && !token) {
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
          agentName?: string;
        };

        if (msg.type === 'message' && msg.content) {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers.Authorization = `Bearer ${token}`;

          await fetch(`${apiUrl}/api/sessions/${msg.sessionId}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content: msg.content }),
          });
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

  server.listen(port, process.env.GATEWAY_HOST ?? '0.0.0.0', () => {
    console.log(`Gateway on :${port}/ws (auth ${auth.enabled ? 'enabled' : 'disabled'})`);
  });

  process.on('SIGINT', async () => {
    await eventBus.close();
    await webChat.stop();
    process.exit(0);
  });
}

main().catch(console.error);
