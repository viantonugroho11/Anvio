import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AgentsController } from './agents.controller.js';
import { SessionsController } from './sessions.controller.js';
import { AppService } from './app.service.js';

import { WhatsAppController } from './whatsapp.controller.js';
import { TeamsController } from './teams.controller.js';
import { MatrixController } from './matrix.controller.js';

@Module({
  controllers: [
    HealthController,
    AgentsController,
    SessionsController,
    WhatsAppController,
    TeamsController,
    MatrixController,
  ],
  providers: [AppService],
})
export class AppModule {}
