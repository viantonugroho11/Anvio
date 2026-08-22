import { Public } from './auth.guard.js';
import { Controller, Post, Body, Req, Res, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service.js';
import { TeamsChannel } from '@anvio/channels';
import {
  createBotFrameworkJwks,
  resolveWebhookSecrets,
  unconfiguredWebhookIsAllowed,
  verifyTeamsJwt,
  type JwksSource,
} from '@anvio/platform';

/**
 * Module-level so the key cache survives between requests. Microsoft's signing
 * keys change rarely; fetching metadata and JWKS per webhook would add two
 * round-trips to every inbound message.
 */
const botFrameworkJwks: JwksSource = createBotFrameworkJwks();

// Outside AnvioAuthGuard: Microsoft posts here and cannot present a user token.
// It authenticates with a Bot Framework JWT instead, verified against
// Microsoft's published signing keys (ADR-0021).
@Public()
@Controller('channels/teams')
export class TeamsController {
  constructor(private readonly appService: AppService) {}

  @Post('webhook')
  async receive(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    // Authenticate first: a 404 for an unregistered channel would otherwise tell
    // an unauthenticated caller what this deployment runs.
    const { teamsAppId } = resolveWebhookSecrets(process.env);
    if (!teamsAppId) {
      if (!unconfiguredWebhookIsAllowed(process.env)) {
        res.status(HttpStatus.UNAUTHORIZED).send('Set TEAMS_APP_ID to verify Bot Framework tokens');
        return;
      }
    } else {
      const activity = body as { serviceUrl?: string };
      let verdict;
      try {
        verdict = await verifyTeamsJwt({
          authorization: req.header('authorization'),
          appId: teamsAppId,
          jwks: botFrameworkJwks,
          now: Math.floor(Date.now() / 1000),
          serviceUrl: activity?.serviceUrl,
        });
      } catch (error) {
        // Reaching Microsoft's key endpoint can fail. Treat that as "cannot
        // verify", not "verified" — an outage upstream must not become an open
        // endpoint here. 503 says the check could not run, which is a different
        // fact from 401 saying the caller failed it.
        const reason = error instanceof Error ? error.message : 'key lookup failed';
        res.status(HttpStatus.SERVICE_UNAVAILABLE).send(`Could not verify token: ${reason}`);
        return;
      }
      if (!verdict.ok) {
        res.status(HttpStatus.UNAUTHORIZED).send(`Token rejected: ${verdict.reason}`);
        return;
      }
    }

    const adapter = this.appService.platform.channelHub.getAdapter('teams');
    if (!adapter || !(adapter instanceof TeamsChannel)) {
      res.status(HttpStatus.NOT_FOUND).send('Teams channel not registered');
      return;
    }

    const activity = body as Parameters<TeamsChannel['handleActivity']>[0];
    await adapter.handleActivity(activity);
    res.status(HttpStatus.OK).send({});
  }
}
