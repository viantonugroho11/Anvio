import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AgentsController } from './agents.controller.js';
import { SessionsController } from './sessions.controller.js';
import { AppService } from './app.service.js';

import { WhatsAppController } from './whatsapp.controller.js';

@Module({
  controllers: [HealthController, AgentsController, SessionsController, WhatsAppController],
  providers: [AppService],
})
export class AppModule {}
