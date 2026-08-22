import { Public } from './auth.guard.js';
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  HttpStatus,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service.js';
import {
  resolveWebhookSecrets,
  unconfiguredWebhookIsAllowed,
  verifyMetaSignature,
} from './webhook-auth.js';

// Outside AnvioAuthGuard: Meta posts here and cannot present a user token. It
// authenticates by its own mechanism instead — `hub.verify_token` on the GET
// handshake, and an HMAC signature on every POST (ADR-0021).
@Public()
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
  async receive(
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    // Authenticate before touching platform state. Answering "WhatsApp channel
    // not enabled" to an unverified caller tells them what this deployment runs.
    //
    // The GET handshake proves the endpoint belongs to this operator, once, at
    // configuration time. It says nothing about who is posting now.
    const { whatsappAppSecret } = resolveWebhookSecrets(process.env);
    if (!whatsappAppSecret) {
      if (!unconfiguredWebhookIsAllowed(process.env)) {
        res
          .status(HttpStatus.UNAUTHORIZED)
          .send('Set WHATSAPP_APP_SECRET to verify webhook signatures');
        return;
      }
    } else {
      const verdict = verifyMetaSignature({
        rawBody: req.rawBody,
        header: req.header('x-hub-signature-256'),
        appSecret: whatsappAppSecret,
      });
      if (!verdict.ok) {
        res.status(HttpStatus.UNAUTHORIZED).send(`Signature rejected: ${verdict.reason}`);
        return;
      }
    }

    const whatsapp = this.appService.platform.whatsapp;
    if (!whatsapp) {
      res.status(HttpStatus.NOT_FOUND).send('WhatsApp channel not enabled');
      return;
    }

    await whatsapp.handleWebhook(body);
    res.status(HttpStatus.OK).send('OK');
  }
}
