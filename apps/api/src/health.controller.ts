import { Public } from './auth.guard.js';
import { Controller, Get } from '@nestjs/common';

// Public: liveness probes must answer without credentials.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'anvio-api', timestamp: new Date().toISOString() };
  }
}
