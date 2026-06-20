import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';
import { MatrixChannel } from '@anvio/channels';

@Controller('channels/matrix')
export class MatrixController {
  constructor(private readonly appService: AppService) {}

  @Post('webhook')
  async receive(@Body() body: unknown, @Res() res: Response): Promise<void> {
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
