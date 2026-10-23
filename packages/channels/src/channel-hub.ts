import type {
  AgentNotification,
  ApprovalRequestMessage,
  ChannelAdapter,
  ChannelHubPort,
  ChannelStartFailure,
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

  listAdapters(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  listChannelTypes(): ChannelType[] {
    return [...this.adapters.keys()];
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

  async setTyping(channel: ChannelType, sessionId: string, active: boolean): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter?.setTyping) return;
    await adapter.setTyping(sessionId, active);
  }

  /**
   * Starts every adapter; one that fails no longer takes the others down.
   * `Promise.all` rejected on the first failure, so an expired Discord token
   * stopped the whole gateway from booting even though the rest had started
   * (audit T-012). Failures are logged and returned for health reporting.
   */
  async startAll(): Promise<ChannelStartFailure[]> {
    const adapters = [...this.adapters.values()];
    const results = await Promise.allSettled(adapters.map((a) => a.start()));
    const failures: ChannelStartFailure[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') return;
      const channel = adapters[i]!.channelType;
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[channels] ${channel} failed to start: ${error}`);
      failures.push({ channel, error });
    });
    return failures;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.stop()));
  }
}
