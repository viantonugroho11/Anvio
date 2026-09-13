import http from 'node:http';
import express from 'express';
import type { AgentDefinition } from '@anvio/core';
import type { AgentCard } from '@a2a-js/sdk';
import { A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import {
  InMemoryPushNotificationStore,
  DefaultPushNotificationSender,
} from '@a2a-js/sdk/server';
import {
  jsonRpcHandler,
  restHandler,
  agentCardHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import { AnvioAgentExecutor, type AnvioMessageHandler } from './anvio-agent-executor.js';
import { buildAgentCard, type AgentCardBuilderOptions } from './agent-card-builder.js';

export type { AnvioMessageHandler } from './anvio-agent-executor.js';

export interface A2AServerConfig {
  host: string;
  port: number;
  agents: AgentDefinition[];
  cardOptions: AgentCardBuilderOptions;
  onMessage: AnvioMessageHandler;
  enablePushNotifications?: boolean;
  userBuilder?: (req: import('express').Request) => Promise<import('@a2a-js/sdk/server').User>;
}

export interface A2AServerStatus {
  running: boolean;
  host: string;
  port: number;
}

export class A2AServer {
  private server: http.Server | null = null;
  private readonly app: express.Express;
  private readonly agentCard: AgentCard;
  readonly requestHandler: DefaultRequestHandler;
  readonly executor: AnvioAgentExecutor;

  constructor(private readonly config: A2AServerConfig) {
    this.agentCard = buildAgentCard(config.agents[0]!, config.cardOptions);

    const taskStore = new InMemoryTaskStore();
    this.executor = new AnvioAgentExecutor(config.onMessage);

    let pushStore: InMemoryPushNotificationStore | undefined;
    let pushSender: DefaultPushNotificationSender | undefined;
    if (config.enablePushNotifications !== false) {
      pushStore = new InMemoryPushNotificationStore();
      pushSender = new DefaultPushNotificationSender(pushStore);
    }

    this.requestHandler = new DefaultRequestHandler(
      this.agentCard,
      taskStore,
      this.executor,
      undefined, // eventBusManager
      pushStore,
      pushSender,
    );

    this.app = express();
    const cardMiddleware = agentCardHandler({ agentCardProvider: this.requestHandler });
    this.app.use('/.well-known/agent.json', cardMiddleware);
    this.app.use('/.well-known/agent-card.json', cardMiddleware);
    const ub = config.userBuilder ?? UserBuilder.noAuthentication;
    this.app.use(
      '/a2a',
      jsonRpcHandler({ requestHandler: this.requestHandler, userBuilder: ub }),
    );
    this.app.use(
      '/a2a',
      restHandler({ requestHandler: this.requestHandler, userBuilder: ub }),
    );

    this.app.get('/a2a/health', (_req, res) => {
      res.json({
        status: 'ok',
        protocol: `a2a/v${A2A_PROTOCOL_VERSION}`,
        agents: 1,
      });
    });
  }

  getStatus(): A2AServerStatus {
    return {
      running: this.server !== null,
      host: this.config.host,
      port: this.config.port,
    };
  }

  getAgentCard(): AgentCard {
    return this.agentCard;
  }

  async start(): Promise<number> {
    if (this.server) return this.config.port;

    this.server = http.createServer(this.app);

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

  async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const originalUrl = req.url;
    req.url = pathname;

    return new Promise<boolean>((resolve) => {
      const originalEnd = res.end.bind(res);
      let handled = false;

      res.end = function (...args: any[]) {
        handled = true;
        return originalEnd(...args);
      } as any;

      this.app(req as any, res as any, () => {
        req.url = originalUrl;
        resolve(false);
      });

      setImmediate(() => {
        if (handled) resolve(true);
      });
    });
  }
}
