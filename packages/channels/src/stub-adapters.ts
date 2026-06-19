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

/** Base adapter with optional progress/notification/approval hooks. */
abstract class BaseChannelAdapter implements ChannelAdapter {
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
      content: `**${notification.title}**${notification.body ? `\n${notification.body}` : ''}`,
      metadata: { notification },
    });
  }

  async sendApprovalRequest(sessionId: string, request: ApprovalRequestMessage): Promise<void> {
    await this.sendMessage(sessionId, {
      sessionId,
      type: 'message',
      content: `⚠️ Approval required: ${request.toolName}\n${request.reason}\nReply with Approve or Reject.`,
      metadata: { approvalRequest: request },
    });
  }
}

/** Stub — wire real Telegram Bot API in channel config. */
export class TelegramChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'telegram';

  async sendMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

export class WhatsAppChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'whatsapp';

  async sendMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

export class DiscordChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'discord';

  async sendMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

export class SlackChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'slack';

  async sendMessage(_sessionId: string, _message: OutboundMessage): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

export function createStubAdapters(): ChannelAdapter[] {
  return [
    new TelegramChannel(),
    new WhatsAppChannel(),
    new DiscordChannel(),
    new SlackChannel(),
  ];
}
