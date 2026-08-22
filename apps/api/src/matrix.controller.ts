import { Public } from './auth.guard.js';
import { Controller, Post, Body, Query, Req, Res, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service.js';
import { MatrixChannel } from '@anvio/channels';
import {
  resolveWebhookSecrets,
  unconfiguredWebhookIsAllowed,
  verifyMatrixToken,
} from '@anvio/platform';

// Outside AnvioAuthGuard: the homeserver posts here and cannot present a user
// token. It authenticates with the application-service `as_token` instead
// (ADR-0021).
@Public()
@Controller('channels/matrix')
export class MatrixController {
  constructor(private readonly appService: AppService) {}

  @Post('webhook')
  async receive(
    @Body() body: unknown,
    @Query('access_token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Authenticate before looking anything up. Answering 404 for an unregistered
    // channel and 401 for a bad token tells an unauthenticated caller which
    // channels this deployment runs; the check that costs nothing goes first.
    const { matrixAsToken } = resolveWebhookSecrets(process.env);
    if (!matrixAsToken) {
      if (!unconfiguredWebhookIsAllowed(process.env)) {
        res.status(HttpStatus.UNAUTHORIZED).send('Set MATRIX_AS_TOKEN to verify the homeserver');
        return;
      }
    } else {
      const verdict = verifyMatrixToken({
        authorization: req.header('authorization'),
        queryToken,
        asToken: matrixAsToken,
      });
      if (!verdict.ok) {
        res.status(HttpStatus.UNAUTHORIZED).send(`Rejected: ${verdict.reason}`);
        return;
      }
    }

    const adapter = this.appService.platform.channelHub.getAdapter('matrix');
    if (!adapter || !(adapter instanceof MatrixChannel)) {
      res.status(HttpStatus.NOT_FOUND).send('Matrix channel not registered');
      return;
    }

    const payload = body as { roomId?: string; senderId?: string; body?: string };
    if (!payload.roomId || !payload.senderId || !payload.body) {
      res.status(HttpStatus.BAD_REQUEST).send('roomId, senderId, and body required');
      return;
    }

    await adapter.handleRoomMessage({
      roomId: payload.roomId,
      senderId: payload.senderId,
      body: payload.body,
    });
    res.status(HttpStatus.OK).send({ ok: true });
  }
}
