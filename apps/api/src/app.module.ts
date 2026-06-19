import fs from 'node:fs/promises';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AgentsController } from './agents.controller.js';
import { SessionsController } from './sessions.controller.js';
import { AppService } from './app.service.js';

@Module({
  controllers: [HealthController, AgentsController, SessionsController],
  providers: [AppService],
})
export class AppModule {}
