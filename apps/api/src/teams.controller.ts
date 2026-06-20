import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';
import { TeamsChannel } from '@anvio/channels';

@Controller('channels/teams')
export class TeamsController {
  constructor(private readonly appService: AppService) {}

  @Post('webhook')
  async receive(@Body() body: unknown, @Res() res: Response): Promise<void> {
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
