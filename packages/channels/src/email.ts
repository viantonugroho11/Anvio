import type { ChannelType, OutboundMessage } from '@anvio/core';
import { WebhookChannelAdapter, type WebhookChannelOptions } from './webhook-channel-base.js';
import { sendSmtpMail } from './smtp-client.js';

export interface EmailChannelOptions extends WebhookChannelOptions {
  smtpHost?: string;
  smtpPort?: number;
  imapHost?: string;
  imapPort?: number;
  pollIntervalMs?: number;
  username?: string;
  password?: string;
  fromAddress?: string;
}

/** Email adapter — SMTP outbound + optional IMAP inbound polling. */
export class EmailChannel extends WebhookChannelAdapter {
  readonly channelType: ChannelType = 'email';
  readonly outboundQueue: Array<{ sessionId: string; to?: string; subject?: string; body: string }> =
    [];
  private readonly seenImapUids = new Set<number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly emailOptions: EmailChannelOptions) {
    super(emailOptions);
  }

  isConfigured(): boolean {
    return Boolean(this.emailOptions.smtpHost && this.emailOptions.username);
  }

  isImapConfigured(): boolean {
    return Boolean(this.emailOptions.imapHost && this.emailOptions.username);
  }

  async handleInboundEmail(input: {
    from: string;
    subject: string;
    body: string;
  }): Promise<{ sessionId: string; userId: string }> {
    const userId = `email:${input.from}`;
    const threadId = `email:${input.from}:${input.subject}`;
    const session = await this.options.sessionBridge.resolveOrCreate(
      'email',
      threadId,
      this.emailOptions.defaultAgent,
    );

    const content = `Subject: ${input.subject}\n\n${input.body}`;
    await this.options.sessions.update(session.id, {
      metadata: {
        ...session.metadata,
        email: { from: input.from, subject: input.subject },
      },
    });

    await this.handleInbound(session.id, userId, content, 'email');
    return { sessionId: session.id, userId };
  }

  protected async deliverMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!message.content) return;

    const session = await this.options.sessions.get(sessionId);
    const emailMeta = session?.metadata?.email as { from?: string; subject?: string } | undefined;

    const outbound = {
      sessionId,
      to: emailMeta?.from,
      subject: emailMeta?.subject ? `Re: ${emailMeta.subject}` : 'Anvio reply',
      body: message.content,
    };
    this.outboundQueue.push(outbound);

    if (!this.isConfigured() || !outbound.to) return;

    const from = this.emailOptions.fromAddress ?? this.emailOptions.username!;
    try {
      await sendSmtpMail({
        host: this.emailOptions.smtpHost!,
        port: this.emailOptions.smtpPort,
        username: this.emailOptions.username!,
        password: this.emailOptions.password ?? '',
        from,
        to: outbound.to,
        subject: outbound.subject ?? 'Anvio reply',
        body: outbound.body,
      });
    } catch (error) {
      console.error(
        `[Email] SMTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Poll IMAP INBOX for unseen messages and dispatch as inbound email. */
  async pollInbox(): Promise<number> {
    if (!this.isImapConfigured()) return 0;

    const { pollImapInbox } = await import('./imap-client.js');
    const messages = await pollImapInbox(
      {
        host: this.emailOptions.imapHost!,
        port: this.emailOptions.imapPort,
        username: this.emailOptions.username!,
        password: this.emailOptions.password ?? '',
      },
      this.seenImapUids,
    );

    for (const message of messages) {
      await this.handleInboundEmail({
        from: message.from,
        subject: message.subject,
        body: message.body,
      });
    }

    return messages.length;
  }

  override async start(): Promise<void> {
    if (!this.isImapConfigured()) return;
    const intervalMs = this.emailOptions.pollIntervalMs ?? 60_000;
    this.pollTimer = setInterval(() => {
      void this.pollInbox().catch((error) => {
        console.error(
          `[Email] IMAP poll failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);
  }

  override async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await super.stop();
  }
}
