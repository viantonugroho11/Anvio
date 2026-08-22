import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChannelType } from '@anvio/core';
import { EventSubjects } from '@anvio/events';
import { TeamsChannel, MatrixChannel } from '@anvio/channels';
import type { PlatformContext } from './platform-context.js';
import {
  createBotFrameworkJwks,
  resolveWebhookSecrets,
  unconfiguredWebhookIsAllowed,
  verifyMatrixToken,
  verifyMetaSignature,
  verifyTeamsJwt,
  type JwksSource,
  type WebhookVerdict,
} from './webhook-auth.js';

/** Module-level so Microsoft's key cache survives between requests. */
const botFrameworkJwks: JwksSource = createBotFrameworkJwks();

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Returns null when authentication was required and failed — the caller must
 * answer 401 rather than proceed.
 *
 * This used to end `return ctx ?? auth.getDefaultContext()`, which is the same
 * defect ADR-0018 removed from `sessions.controller.ts`: a bad token, an expired
 * token, or no token at all resolved to the default context and the request
 * carried on. Turning on `auth.enabled` did not close the door; it added a lock
 * that opened when jiggled. It was fixed in `apps/api` and left standing here
 * (issue #42).
 */
async function resolveAuth(platform: PlatformContext, authHeader?: string) {
  const { auth } = platform;
  if (!auth.enabled) return auth.getDefaultContext();
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  return (await auth.authenticate(token)) ?? null;
}

/**
 * Shared gate for the channel webhooks. Fails closed when nothing is configured,
 * with the same `ANVIO_API_ALLOW_INSECURE` escape hatch as `apps/api` (ADR-0021
 * D2) — one declaration, one meaning, across both surfaces.
 */
function unverifiedAllowed(res: ServerResponse, hint: string): boolean {
  if (unconfiguredWebhookIsAllowed(process.env)) return true;
  json(res, 401, { error: hint });
  return false;
}

function rejected(res: ServerResponse, verdict: WebhookVerdict): boolean {
  if (verdict.ok) return false;
  json(res, 401, { error: `Rejected: ${verdict.reason}` });
  return true;
}

export async function handleGatewayHttp(
  platform: PlatformContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = req.method ?? 'GET';

  if (method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    json(res, 200, {
      status: 'ok',
      service: 'anvio-unified-gateway',
      auth: platform.auth.enabled,
      sessions: platform.workspace.config.spec.storage.provider,
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/sessions') {
    const ctx = await resolveAuth(platform, req.headers.authorization);
    if (!ctx) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const raw = await readBody(req);
    const body = JSON.parse(raw) as {
      agentName: string;
      channel?: string;
      detached?: boolean;
      channelThreadId?: string;
    };

    try {
      await platform.workspace.loader.loadAgent(body.agentName);
    } catch {
      json(res, 404, { error: 'Agent not found' });
      return true;
    }

    const session = await platform.workspace.sessions.create({
      userId: ctx.userId,
      agentName: body.agentName,
      channel: body.channel ?? 'rest',
      messages: [],
      status: 'idle',
      detached: body.detached,
      channelThread: body.channelThreadId
        ? { channel: (body.channel ?? 'rest') as ChannelType, threadId: body.channelThreadId }
        : undefined,
    });

    await platform.eventBus.publish(EventSubjects.SESSION_STARTED, 'anvio.session.started', {
      sessionId: session.id,
      userId: ctx.userId,
      agentId: body.agentName,
      channel: session.channel,
    });

    json(res, 201, { id: session.id, agentName: session.agentName, channel: session.channel });
    return true;
  }

  const sessionGet = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessionGet) {
    const ctx = await resolveAuth(platform, req.headers.authorization);
    if (!ctx) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const session = await platform.workspace.sessions.get(sessionGet[1]!);
    if (!session || (platform.auth.enabled && session.userId !== ctx.userId)) {
      json(res, 404, { error: 'Not found' });
      return true;
    }
    json(res, 200, session);
    return true;
  }

  const sessionMsg = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (method === 'POST' && sessionMsg) {
    const ctx = await resolveAuth(platform, req.headers.authorization);
    if (!ctx) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const session = await platform.workspace.sessions.get(sessionMsg[1]!);
    if (!session || (platform.auth.enabled && session.userId !== ctx.userId)) {
      json(res, 404, { error: 'Not found' });
      return true;
    }
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { content: string };
    await platform.eventBus.publish(
      EventSubjects.AGENT_RUN_REQUESTED,
      'anvio.agent.run.requested',
      {
        sessionId: session.id,
        userId: ctx.userId,
        agentId: session.agentName,
        content: body.content,
        channel: session.channel,
        detached: session.detached,
      },
    );
    json(res, 202, { status: 'queued', sessionId: session.id });
    return true;
  }

  if (method === 'GET' && pathname === '/api/channels/whatsapp/webhook') {
    const whatsapp = platform.whatsapp;
    if (!whatsapp) {
      json(res, 404, { error: 'WhatsApp channel not enabled' });
      return true;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const result = whatsapp.verifyWebhook({
      'hub.mode': url.searchParams.get('hub.mode') ?? undefined,
      'hub.verify_token': url.searchParams.get('hub.verify_token') ?? undefined,
      'hub.challenge': url.searchParams.get('hub.challenge') ?? undefined,
    });
    if (result) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(result);
    } else {
      res.writeHead(403);
      res.end('Verification failed');
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/channels/whatsapp/webhook') {
    // Read first: the signature covers the raw bytes, and this server has no
    // body parser to capture them behind. Authenticate before touching platform
    // state, so an unverified caller cannot learn which channels are enabled.
    const raw = await readBody(req);
    const { whatsappAppSecret } = resolveWebhookSecrets(process.env);
    if (!whatsappAppSecret) {
      if (!unverifiedAllowed(res, 'Set WHATSAPP_APP_SECRET to verify webhook signatures')) {
        return true;
      }
    } else if (
      rejected(
        res,
        verifyMetaSignature({
          rawBody: raw,
          header: req.headers['x-hub-signature-256'] as string | undefined,
          appSecret: whatsappAppSecret,
        }),
      )
    ) {
      return true;
    }

    const whatsapp = platform.whatsapp;
    if (!whatsapp) {
      json(res, 404, { error: 'WhatsApp channel not enabled' });
      return true;
    }
    await whatsapp.handleWebhook(JSON.parse(raw));
    res.writeHead(200);
    res.end('OK');
    return true;
  }

  if (method === 'POST' && pathname === '/api/channels/teams/webhook') {
    const raw = await readBody(req);
    const { teamsAppId } = resolveWebhookSecrets(process.env);
    if (!teamsAppId) {
      if (!unverifiedAllowed(res, 'Set TEAMS_APP_ID to verify Bot Framework tokens')) return true;
    } else {
      const activity = JSON.parse(raw) as { serviceUrl?: string };
      let verdict: WebhookVerdict;
      try {
        verdict = await verifyTeamsJwt({
          authorization: req.headers.authorization,
          appId: teamsAppId,
          jwks: botFrameworkJwks,
          now: Math.floor(Date.now() / 1000),
          serviceUrl: activity?.serviceUrl,
        });
      } catch (error) {
        // Could not verify is not the same fact as failed verification, and an
        // outage at Microsoft must not become an open endpoint here.
        json(res, 503, {
          error: `Could not verify token: ${error instanceof Error ? error.message : 'key lookup failed'}`,
        });
        return true;
      }
      if (rejected(res, verdict)) return true;
    }

    const adapter = platform.channelHub.getAdapter('teams');
    if (!adapter || !(adapter instanceof TeamsChannel)) {
      json(res, 404, { error: 'Teams channel not registered' });
      return true;
    }
    await adapter.handleActivity(JSON.parse(raw));
    json(res, 200, {});
    return true;
  }

  if (method === 'POST' && pathname === '/api/channels/matrix/webhook') {
    const { matrixAsToken } = resolveWebhookSecrets(process.env);
    if (!matrixAsToken) {
      if (!unverifiedAllowed(res, 'Set MATRIX_AS_TOKEN to verify the homeserver')) return true;
    } else {
      const queryToken =
        new URL(req.url ?? '/', 'http://localhost').searchParams.get('access_token') ?? undefined;
      if (
        rejected(
          res,
          verifyMatrixToken({
            authorization: req.headers.authorization,
            queryToken,
            asToken: matrixAsToken,
          }),
        )
      ) {
        return true;
      }
    }

    const adapter = platform.channelHub.getAdapter('matrix');
    if (!adapter || !(adapter instanceof MatrixChannel)) {
      json(res, 404, { error: 'Matrix channel not registered' });
      return true;
    }
    const raw = await readBody(req);
    const payload = JSON.parse(raw) as { roomId?: string; senderId?: string; body?: string };
    if (!payload.roomId || !payload.senderId || !payload.body) {
      json(res, 400, { error: 'roomId, senderId, and body required' });
      return true;
    }
    await adapter.handleRoomMessage({
      roomId: payload.roomId,
      senderId: payload.senderId,
      body: payload.body,
    });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
