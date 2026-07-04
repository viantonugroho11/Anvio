import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('overview')
export class OverviewController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async overview() {
    const { workspace, toolGateway } = this.appService.platform;

    const [sessions, agents] = await Promise.all([
      workspace.sessions.list(),
      workspace.loader.listAgents(),
    ]);

    const tools = Object.entries(toolGateway.spec.tools);
    const enabledTools = tools.filter(([, cfg]) => cfg.enabled).length;

    const activeSessions = sessions.filter(
      (s) => s.status !== 'completed',
    ).length;

    return {
      sessions: { total: sessions.length, active: activeSessions },
      agents: { total: agents.length },
      tools: { total: tools.length, enabled: enabledTools },
      health: { status: 'ok', uptime: process.uptime() },
    };
  }
}
