import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('agents')
export class AgentsController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async list() {
    const names = await this.appService.platform.workspace.loader.listAgents();
    const agents = await Promise.all(
      names.map(async (name) => {
        const def = await this.appService.platform.workspace.loader.loadAgent(name);
        return { name, description: def.spec.description, spec: def.spec };
      }),
    );
    return agents;
  }

  @Get(':name')
  async get(@Param('name') name: string) {
    try {
      return await this.appService.platform.workspace.loader.loadAgent(name);
    } catch {
      return { error: 'Not found' };
    }
  }
}
