import type {
  ApprovalRequestMessage,
  ChannelType,
  OutboundMessage,
  SessionStore,
} from '@anvio/core';
import { BaseChannelAdapter } from './base-channel-adapter.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';

export interface WhatsAppChannelOptions {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  sessionBridge: ChannelSessionBridge;
  sessions: SessionStore;
  defaultAgent?: string;
  onApproval?: (
    sessionId: string,
    requestId: string,
    approved: boolean,
    userId?: string,
  ) => Promise<void>;
}

interface WhatsAppTarget {
  waId: string;
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<WhatsAppInboundMessage>;
        contacts?: Array<{ wa_id: string }>;
      };
    }>;
  }>;
}

interface WhatsAppInboundMessage {
  from: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
  };
}

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function threadKey(waId: string): string {
  return `phone:${waId}`;
}

function parseWhatsAppTarget(session: {
  channelThread?: { threadId: string };
  metadata?: Record<string, unknown>;
}): WhatsAppTarget | null {
  const meta = session.metadata?.whatsapp as WhatsAppTarget | undefined;
  if (meta?.waId) return meta;

  const threadId = session.channelThread?.threadId;
  if (!threadId) return null;
  const match = threadId.match(/^phone:(.+)$/);
  return match ? { waId: match[1]! } : null;
}

export class WhatsAppChannel extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'whatsapp';
  private readonly buffer = new Map<string, string>();

  constructor(private readonly options: WhatsAppChannelOptions) {
    super();
  }

  private async graphApi(body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${GRAPH_API}/${this.options.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp API: ${res.status} ${err}`);
    }
  }

  async sendMessage(sessionId: string, message: OutboundMessage): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseWhatsAppTarget(session);
    if (!target) return;

    if (message.type === 'chunk' && message.delta) {
      this.buffer.set(sessionId, (this.buffer.get(sessionId) ?? '') + message.delta);
      return;
    }

    let text = message.content ?? '';
    if (message.type === 'done') {
      text = message.content ?? this.buffer.get(sessionId) ?? text;
      this.buffer.delete(sessionId);
    }
    if (!text) return;

    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      await this.graphApi({
        messaging_product: 'whatsapp',
        to: target.waId,
        type: 'text',
        text: { body: chunk },
      });
    }
  }

  protected async sendApprovalRequestWithActions(
    sessionId: string,
    request: ApprovalRequestMessage,
  ): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) return;
    const target = parseWhatsAppTarget(session);
    if (!target) return;

    await this.graphApi({
      messaging_product: 'whatsapp',
      to: target.waId,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: `⚠️ Approval required\nTool: ${request.toolName}\n${request.reason}`,
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: { id: `approve:${request.requestId}`, title: 'Approve' },
            },
            {
              type: 'reply',
              reply: { id: `reject:${request.requestId}`, title: 'Reject' },
            },
          ],
        },
      },
    });
  }

  /** Meta webhook verification (GET). Returns challenge string or null. */
  verifyWebhook(query: Record<string, string | undefined>): string | null {
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === this.options.verifyToken &&
      query['hub.challenge']
    ) {
      return query['hub.challenge'];
    }
    return null;
  }

  /** Process inbound webhook payload (POST). */
  async handleWebhook(body: unknown): Promise<void> {
    const payload = body as WhatsAppWebhookBody;
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          await this.handleInboundMessage(msg);
        }
      }
    }
  }

  async start(): Promise<void> {
    console.log('[WhatsApp] Webhook mode — mount POST /channels/whatsapp/webhook on API');
  }

  async stop(): Promise<void> {}

  private async handleInboundMessage(msg: WhatsAppInboundMessage): Promise<void> {
    const waId = msg.from;
    const threadId = threadKey(waId);
    const userId = `whatsapp:${waId}`;

    if (msg.type === 'interactive' && msg.interactive?.button_reply) {
      const { id } = msg.interactive.button_reply;
      const [action, requestId] = id.split(':');
      if (requestId && this.options.onApproval) {
        const session = await this.options.sessionBridge.resolveOrCreate('whatsapp', threadId, userId);
        await this.options.onApproval(session.id, requestId, action === 'approve', userId);
      }
      return;
    }

    if (msg.type !== 'text' || !msg.text?.body) return;

    const session = await this.options.sessionBridge.resolveOrCreate(
      'whatsapp',
      threadId,
      userId,
      this.options.defaultAgent,
    );

    if (!session.metadata?.whatsapp) {
      await this.options.sessions.update(session.id, {
        metadata: { ...session.metadata, whatsapp: { waId } },
      });
    }

    const normalized = msg.text.body.trim().toLowerCase();
    if (normalized === 'approve' || normalized === 'reject') {
      const pending = session.pendingApproval;
      if (pending && this.options.onApproval) {
        await this.options.onApproval(session.id, pending.id, normalized === 'approve');
        return;
      }
    }

    await this.dispatchInbound({
      sessionId: session.id,
      userId,
      content: msg.text.body,
      channel: 'whatsapp',
      channelThreadId: threadId,
    });
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}
