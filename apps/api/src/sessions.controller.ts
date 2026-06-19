import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { EventSubjects } from '@anvio/events';
import { AppService } from './app.service.js';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly appService: AppService) {}

  private async resolveAuth(authHeader?: string) {
    const { auth } = this.appService.platform;
    if (!auth.enabled) return auth.getDefaultContext();
    const token = authHeader?.replace('Bearer ', '');
    const ctx = await auth.authenticate(token);
    return ctx ?? auth.getDefaultContext();
  }

  @Post()
  async create(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { agentName: string; channel?: string },
  ) {
    const ctx = await this.resolveAuth(authHeader);
    const { workspace } = this.appService.platform;

    try {
      await workspace.loader.loadAgent(body.agentName);
    } catch {
      return { error: 'Agent not found' };
    }

    const session = await workspace.sessions.create({
      userId: ctx.userId,
      agentName: body.agentName,
      channel: body.channel ?? 'rest',
      messages: [],
      status: 'idle',
    });

    await this.appService.platform.eventBus.publish(
      EventSubjects.SESSION_STARTED,
      'anvio.session.started',
      {
        sessionId: session.id,
        userId: ctx.userId,
        agentId: body.agentName,
        channel: session.channel,
      },
    );

    return { id: session.id, agentName: session.agentName, channel: session.channel };
  }

  @Get(':id')
  async get(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ctx = await this.resolveAuth(authHeader);
    const session = await this.appService.platform.workspace.sessions.get(id);
    if (!session || (this.appService.platform.auth.enabled && session.userId !== ctx.userId)) {
      return { error: 'Not found' };
    }
    return session;
  }

  @Post(':id/messages')
  async sendMessage(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    const ctx = await this.resolveAuth(authHeader);
    const { workspace, eventBus } = this.appService.platform;
    const session = await workspace.sessions.get(id);
    if (!session || (this.appService.platform.auth.enabled && session.userId !== ctx.userId)) {
      return { error: 'Not found' };
    }

    await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
      sessionId: session.id,
      userId: ctx.userId,
      agentId: session.agentName,
      content: body.content,
      channel: session.channel,
    });

    return { status: 'queued', sessionId: session.id };
  }
}
