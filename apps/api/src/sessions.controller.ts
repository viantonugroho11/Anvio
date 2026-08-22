import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@anvio/core';
import { Auth } from './auth.guard.js';
import type { ChannelType } from '@anvio/core';
import { EventSubjects } from '@anvio/events';
import { AppService } from './app.service.js';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly appService: AppService) {}

  @Post()
  async create(
    @Auth() ctx: AuthContext,
    @Body()
    body: { agentName: string; channel?: string; detached?: boolean; channelThreadId?: string },
  ) {
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
      detached: body.detached,
      channelThread: body.channelThreadId
        ? { channel: (body.channel ?? 'rest') as ChannelType, threadId: body.channelThreadId }
        : undefined,
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

  @Get()
  async list(@Auth() ctx: AuthContext) {
    const sessions = await this.appService.platform.workspace.sessions.list();
    if (this.appService.platform.auth.enabled) {
      return sessions.filter((s) => s.userId === ctx.userId);
    }
    return sessions;
  }

  @Get(':id')
  async get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    const session = await this.appService.platform.workspace.sessions.get(id);
    if (!session || (this.appService.platform.auth.enabled && session.userId !== ctx.userId)) {
      return { error: 'Not found' };
    }
    return session;
  }

  @Post(':id/messages')
  async sendMessage(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
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
      detached: session.detached,
    });

    return { status: 'queued', sessionId: session.id };
  }
}
