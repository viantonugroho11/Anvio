import { Controller, Get, Post, Query, Body, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';

@Controller('channels/whatsapp')
export class WhatsAppController {
  constructor(private readonly appService: AppService) {}

  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const whatsapp = this.appService.platform.whatsapp;
    if (!whatsapp) {
      res.status(HttpStatus.NOT_FOUND).send('WhatsApp channel not enabled');
      return;
    }

    const result = whatsapp.verifyWebhook({
      'hub.mode': mode,
      'hub.verify_token': verifyToken,
      'hub.challenge': challenge,
    });

    if (result) {
      res.status(HttpStatus.OK).send(result);
    } else {
      res.status(HttpStatus.FORBIDDEN).send('Verification failed');
    }
  }

  @Post('webhook')
  async receive(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const whatsapp = this.appService.platform.whatsapp;
    if (!whatsapp) {
      res.status(HttpStatus.NOT_FOUND).send('WhatsApp channel not enabled');
      return;
    }

    await whatsapp.handleWebhook(body);
    res.status(HttpStatus.OK).send('OK');
  }
}
