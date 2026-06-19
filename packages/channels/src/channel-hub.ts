import type {
  AgentNotification,
  ApprovalRequestMessage,
  ChannelAdapter,
  ChannelHubPort,
  ChannelType,
  OutboundMessage,
  ProgressUpdate,
} from '@anvio/core';

export class ChannelHub implements ChannelHubPort {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channelType, adapter);
  }

  getAdapter(channel: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  async sendMessage(
    channel: ChannelType,
    sessionId: string,
    message: OutboundMessage,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) return;
    await adapter.sendMessage(sessionId, message);
  }

  async sendProgress(
    channel: ChannelType,
    sessionId: string,
    update: ProgressUpdate,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter?.sendProgress) return;
    await adapter.sendProgress(sessionId, update);
  }

  async sendNotification(
    channel: ChannelType,
    sessionId: string,
    notification: AgentNotification,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter?.sendNotification) return;
    await adapter.sendNotification(sessionId, notification);
  }

  async sendApprovalRequest(
    channel: ChannelType,
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter?.sendApprovalRequest) return;
    await adapter.sendApprovalRequest(sessionId, request);
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.stop()));
  }
}
