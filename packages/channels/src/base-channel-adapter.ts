import type {
  AgentNotification,
  ApprovalRequestMessage,
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  InboundMessageHandler,
  OutboundMessage,
  ProgressUpdate,
} from '@anvio/core';

export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly channelType: ChannelType;
  protected handler: InboundMessageHandler | null = null;

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  protected async dispatchInbound(message: InboundMessage): Promise<void> {
    if (this.handler) await this.handler(message);
  }

  abstract sendMessage(sessionId: string, message: OutboundMessage): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  async sendProgress(sessionId: string, update: ProgressUpdate): Promise<void> {
    const emoji = update.emoji ?? (update.status === 'completed' ? '✅' : '🔄');
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `${emoji} ${update.phase}`,
      metadata: { progress: update },
    });
  }

  async sendNotification(sessionId: string, notification: AgentNotification): Promise<void> {
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `*${notification.title}*${notification.body ? `\n${notification.body}` : ''}`,
      metadata: { notification },
    });
  }

  async sendApprovalRequest(sessionId: string, request: ApprovalRequestMessage): Promise<void> {
    await this.sendApprovalRequestWithActions(sessionId, request);
  }

  protected abstract sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void>;
}
