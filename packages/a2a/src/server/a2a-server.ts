import http from 'node:http';
import type { AgentDefinition } from '@anvio/core';
import type { AgentCard } from '../types/agent-card.js';
import type { Message } from '../types/message.js';
import type { Task } from '../types/task.js';
import type { SendMessageRequest } from '../types/requests.js';
import type { JsonRpcRequest } from '../types/json-rpc.js';
import { JSON_RPC_ERRORS } from '../types/json-rpc.js';
import { A2AError } from '../types/errors.js';
import { TaskManager } from './task-manager.js';
import { SseStream } from './sse-stream.js';
import { PushNotifier } from './push-notifier.js';
import { buildAgentCard, type AgentCardBuilderOptions } from './agent-card-builder.js';
// mapping imports available for implementors but not used directly in router

/**
 * Handler invoked when an A2A message arrives. Implementors bridge this
 * into the Anvio agent runtime (packages/agents).
 */
export type A2AMessageHandler = (
  taskId: string,
  message: Message,
  taskManager: TaskManager,
) => Promise<void>;

export interface A2AServerConfig {
  host: string;
  port: number;
  agents: AgentDefinition[];
  cardOptions: AgentCardBuilderOptions;
  onMessage: A2AMessageHandler;
}

export interface A2AServerStatus {
  running: boolean;
  host: string;
  port: number;
}

/**
 * A2A v1.0 compliant server.
 * Supports JSON-RPC 2.0 and HTTP+JSON/REST bindings.
 */
export class A2AServer {
  private server: http.Server | null = null;
  readonly taskManager = new TaskManager();
  readonly pushNotifier = new PushNotifier();
  private readonly agentCards: AgentCard[];

  constructor(private readonly config: A2AServerConfig) {
    this.agentCards = config.agents.map((a) => buildAgentCard(a, config.cardOptions));
  }

  getStatus(): A2AServerStatus {
    return {
      running: this.server !== null,
      host: this.config.host,
      port: this.config.port,
    };
  }

  async start(): Promise<number> {
    if (this.server) return this.config.port;

    this.server = http.createServer((req, res) => {
      void this.route(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => resolve());
      this.server!.on('error', reject);
    });

    const addr = this.server.address();
    return typeof addr === 'object' && addr ? addr.port : this.config.port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      srv.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Handle a request from an existing HTTP server (e.g. unified gateway).
   * Returns true if the path was handled.
   */
  async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    return this.routeByPath(req, res, pathname);
  }

  // ── Routing ──────────────────────────────────────────────────

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const handled = await this.routeByPath(req, res, url.pathname);
    if (!handled) this.json(res, 404, { error: 'Not found' });
  }

  private async routeByPath(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // Agent Card discovery
    if (req.method === 'GET' && pathname === '/.well-known/agent.json') {
      const card = this.agentCards[0];
      this.json(res, card ? 200 : 404, card ?? { error: 'No agents configured' });
      return true;
    }

    if (req.method === 'GET' && pathname === '/.well-known/agents.json') {
      this.json(res, 200, this.agentCards);
      return true;
    }

    // Health
    if (req.method === 'GET' && pathname === '/a2a/health') {
      this.json(res, 200, { status: 'ok', protocol: 'a2a/v1.0', agents: this.agentCards.length });
      return true;
    }

    // JSON-RPC endpoint
    if (req.method === 'POST' && pathname === '/a2a') {
      const body = await readJson(req);

      if (isJsonRpcRequest(body)) {
        await this.handleJsonRpc(body, req, res);
      } else {
        await this.handleRestPost(body as Record<string, unknown>, req, res, pathname);
      }
      return true;
    }

    // REST endpoints
    if (pathname.startsWith('/a2a/')) {
      return this.handleRest(req, res, pathname);
    }

    return false;
  }

  // ── JSON-RPC 2.0 binding ────────────────────────────────────

  private async handleJsonRpc(
    rpc: JsonRpcRequest,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const result = await this.dispatchJsonRpc(rpc, req, res);
      if (result !== undefined) {
        this.jsonRpcSuccess(res, rpc.id, result);
      }
    } catch (err) {
      if (err instanceof A2AError) {
        this.jsonRpcError(res, rpc.id, err.httpStatus === 404 ? -32001 : -32000, err.message);
      } else {
        this.jsonRpcError(
          res,
          rpc.id,
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          err instanceof Error ? err.message : 'Internal error',
        );
      }
    }
  }

  private async dispatchJsonRpc(
    rpc: JsonRpcRequest,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<unknown> {
    const p = (rpc.params ?? {}) as Record<string, unknown>;

    switch (rpc.method) {
      case 'sendMessage':
        return this.doSendMessage(p as unknown as SendMessageRequest);

      case 'sendStreamingMessage': {
        const sse = new SseStream(res);
        await this.doSendStreamingMessage(p as unknown as SendMessageRequest, sse);
        return undefined;
      }

      case 'getTask':
        return this.taskManager.getTask(p.id as string);

      case 'listTasks':
        return this.taskManager.listTasks(
          p.contextId as string | undefined,
          p.pageSize as number | undefined,
          p.pageToken as string | undefined,
        );

      case 'cancelTask':
        return this.taskManager.cancelTask(p.id as string);

      case 'subscribeToTask': {
        const sse = new SseStream(res);
        this.doSubscribeToTask(p.id as string, sse);
        return undefined;
      }

      case 'createTaskPushNotificationConfig':
        return this.pushNotifier.addConfig(p.taskId as string, p.config as any);

      case 'getTaskPushNotificationConfig':
        return this.pushNotifier.getConfig(p.taskId as string, p.id as string);

      case 'listTaskPushNotificationConfigs':
        return this.pushNotifier.listConfigs(p.taskId as string);

      case 'deleteTaskPushNotificationConfig':
        this.pushNotifier.deleteConfig(p.taskId as string, p.id as string);
        return { success: true };

      case 'getExtendedAgentCard':
        return this.agentCards[0];

      default:
        this.jsonRpcError(res, rpc.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${rpc.method}`);
        return undefined;
    }
  }

  // ── HTTP+JSON/REST binding ──────────────────────────────────

  private async handleRest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    try {
      // POST /a2a/messages
      if (req.method === 'POST' && pathname === '/a2a/messages') {
        const body = (await readJson(req)) as SendMessageRequest;
        const result = await this.doSendMessage(body);
        this.json(res, 200, result);
        return true;
      }

      // POST /a2a/messages:stream
      if (req.method === 'POST' && pathname === '/a2a/messages:stream') {
        const body = (await readJson(req)) as SendMessageRequest;
        const sse = new SseStream(res);
        await this.doSendStreamingMessage(body, sse);
        return true;
      }

      // GET /a2a/tasks
      if (req.method === 'GET' && pathname === '/a2a/tasks') {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const result = this.taskManager.listTasks(
          url.searchParams.get('contextId') ?? undefined,
          Number(url.searchParams.get('pageSize')) || undefined,
          url.searchParams.get('pageToken') ?? undefined,
        );
        this.json(res, 200, result);
        return true;
      }

      // Task-specific REST routes: /a2a/tasks/:id[/:action]
      const taskMatch = pathname.match(/^\/a2a\/tasks\/([^/:]+)(:[a-z]+)?(\/.*)?$/);
      if (taskMatch) {
        const taskId = taskMatch[1];
        const action = taskMatch[2] ?? taskMatch[3] ?? '';

        if (req.method === 'GET' && !action) {
          this.json(res, 200, this.taskManager.getTask(taskId));
          return true;
        }

        if (req.method === 'POST' && action === ':cancel') {
          this.json(res, 200, this.taskManager.cancelTask(taskId));
          return true;
        }

        if (req.method === 'GET' && action === ':subscribe') {
          const sse = new SseStream(res);
          this.doSubscribeToTask(taskId, sse);
          return true;
        }

        // Push notification config CRUD
        if (action === '/pushNotificationConfigs' || action.startsWith('/pushNotificationConfigs/')) {
          return this.handlePushNotificationRest(req, res, taskId, action);
        }
      }

      // GET /a2a/agentCard:authenticated
      if (req.method === 'GET' && pathname === '/a2a/agentCard:authenticated') {
        this.json(res, 200, this.agentCards[0]);
        return true;
      }

      return false;
    } catch (err) {
      if (err instanceof A2AError) {
        this.json(res, err.httpStatus, { error: err.code, message: err.message });
      } else {
        this.json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
      }
      return true;
    }
  }

  private handlePushNotificationRest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    action: string,
  ): boolean {
    const configIdMatch = action.match(/\/pushNotificationConfigs\/(.+)$/);
    const configId = configIdMatch?.[1];

    if (req.method === 'GET' && !configId) {
      this.json(res, 200, this.pushNotifier.listConfigs(taskId));
      return true;
    }
    if (req.method === 'GET' && configId) {
      const cfg = this.pushNotifier.getConfig(taskId, configId);
      this.json(res, cfg ? 200 : 404, cfg ?? { error: 'Not found' });
      return true;
    }
    if (req.method === 'POST' && !configId) {
      void readJson(req).then((body) => {
        const result = this.pushNotifier.addConfig(taskId, body as any);
        this.json(res, 201, result);
      });
      return true;
    }
    if (req.method === 'DELETE' && configId) {
      const deleted = this.pushNotifier.deleteConfig(taskId, configId);
      this.json(res, deleted ? 204 : 404, deleted ? null : { error: 'Not found' });
      return true;
    }

    return false;
  }

  private async handleRestPost(
    body: Record<string, unknown>,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _pathname: string,
  ): Promise<void> {
    // Treat as sendMessage REST-style at /a2a
    if (body.message) {
      const result = await this.doSendMessage(body as unknown as SendMessageRequest);
      this.json(res, 200, result);
    } else {
      this.json(res, 400, { error: 'Invalid request body' });
    }
  }

  // ── Core operations ─────────────────────────────────────────

  private async doSendMessage(request: SendMessageRequest): Promise<Task> {
    const task = this.taskManager.createTask(
      request.message.contextId,
      request.metadata,
    );

    this.taskManager.appendHistory(task.id, request.message);
    this.taskManager.updateStatus(task.id, 'working');

    // Set up push notification if configured
    if (request.configuration?.taskPushNotificationConfig) {
      this.pushNotifier.addConfig(task.id, request.configuration.taskPushNotificationConfig);
      this.taskManager.subscribe(task.id, (event) => {
        void this.pushNotifier.deliver(task.id, event);
      });
    }

    if (request.configuration?.returnImmediately) {
      // Fire handler, return immediately
      void this.dispatchAndCatch(task.id, request.message);
      return this.taskManager.getTask(task.id);
    }

    // Subscribe BEFORE dispatching to avoid race when handler completes synchronously
    return new Promise<Task>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(this.taskManager.getTask(task.id));
      }, 30_000);

      const unsubscribe = this.taskManager.subscribe(task.id, (event) => {
        if ('status' in event) {
          const state = event.status.state;
          if (['completed', 'failed', 'canceled', 'rejected', 'input_required', 'auth_required'].includes(state)) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(this.taskManager.getTask(task.id));
          }
        }
      });

      void this.dispatchAndCatch(task.id, request.message);
    });
  }

  private async doSendStreamingMessage(
    request: SendMessageRequest,
    sse: SseStream,
  ): Promise<void> {
    const task = this.taskManager.createTask(
      request.message.contextId,
      request.metadata,
    );

    this.taskManager.appendHistory(task.id, request.message);
    this.taskManager.updateStatus(task.id, 'working');

    const unsubscribe = this.taskManager.subscribe(task.id, (event) => {
      sse.send(event);
      if ('status' in event && ['completed', 'failed', 'canceled', 'rejected'].includes(event.status.state)) {
        unsubscribe();
        sse.end();
      }
    });

    await this.dispatchAndCatch(task.id, request.message);
  }

  private doSubscribeToTask(taskId: string, sse: SseStream): void {
    // Send current status immediately
    const task = this.taskManager.getTask(taskId);
    sse.send({ taskId, status: task.status });

    if (this.taskManager.isTerminal(taskId)) {
      sse.end();
      return;
    }

    const unsubscribe = this.taskManager.subscribe(taskId, (event) => {
      sse.send(event);
      if ('status' in event && ['completed', 'failed', 'canceled', 'rejected'].includes(event.status.state)) {
        unsubscribe();
        sse.end();
      }
    });
  }

  private async dispatchAndCatch(taskId: string, message: Message): Promise<void> {
    try {
      await this.config.onMessage(taskId, message, this.taskManager);
    } catch (err) {
      console.error('[A2A] Message handler error:', err instanceof Error ? err.message : err);
      try {
        this.taskManager.updateStatus(taskId, 'failed');
      } catch {
        // task may already be terminal
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    if (status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private jsonRpcSuccess(res: http.ServerResponse, id: string | number, result: unknown): void {
    this.json(res, 200, { jsonrpc: '2.0', id, result });
  }

  private jsonRpcError(
    res: http.ServerResponse,
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    this.json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
  }
}

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'jsonrpc' in body &&
    (body as any).jsonrpc === '2.0' &&
    'method' in body
  );
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
