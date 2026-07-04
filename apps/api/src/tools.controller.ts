import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('tools')
export class ToolsController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async list() {
    const gateway = this.appService.platform.toolGateway;
    const allTools = Object.entries(gateway.spec.tools).map(([name, cfg]) => ({
      name,
      enabled: cfg.enabled,
    }));
    return allTools;
  }
}
