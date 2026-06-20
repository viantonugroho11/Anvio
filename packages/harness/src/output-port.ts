import type {
  ChannelHubPort,
  ChannelType,
  HarnessOutputPort,
  SoulPolicy,
} from '@anvio/core';
import { ApprovalGate } from './approval-gate.js';
import { formatForChannel } from './format/index.js';

export interface OutputPortDeps {
  channelHub: ChannelHubPort;
  policy: () => SoulPolicy;
  approvalGate: ApprovalGate;
  redact: (text: string) => string;
}

export class HarnessOutputPortImpl implements HarnessOutputPort {
  constructor(
    private readonly sessionId: string,
    private readonly channel: ChannelType,
    private readonly deps: OutputPortDeps,
  ) {}

  async reply(_sessionId: string, text: string): Promise<void> {
    const formatted = formatForChannel(this.channel, this.deps.redact(text));
    await this.deps.channelHub.sendMessage(this.channel, this.sessionId, {
      sessionId: this.sessionId,
      type: 'done',
      content: formatted,
      metadata: { harness: true },
    });
  }

  async edit(_sessionId: string, messageId: string, text: string): Promise<void> {
    const formatted = formatForChannel(this.channel, this.deps.redact(text));
    await this.deps.channelHub.sendMessage(this.channel, this.sessionId, {
      sessionId: this.sessionId,
      type: 'message',
      content: formatted,
      metadata: { harness: true, editMessageId: messageId },
    });
  }

  async setStatus(_sessionId: string, status: string): Promise<void> {
    await this.deps.channelHub.sendProgress(this.channel, this.sessionId, {
      sessionId: this.sessionId,
      phase: status,
      status: 'running',
    });
  }

  async requestApproval(_sessionId: string, summary: string): Promise<string> {
    return this.deps.approvalGate.requestApproval(this.sessionId, this.channel, summary);
  }
}

export function createHarnessOutputPort(
  sessionId: string,
  channel: ChannelType,
  deps: OutputPortDeps,
): HarnessOutputPort {
  return new HarnessOutputPortImpl(sessionId, channel, deps);
}

export function createHarnessToolHandlers(
  sessionId: string,
  channel: ChannelType,
  deps: OutputPortDeps,
): Record<string, (args: Record<string, unknown>) => Promise<string>> {
  const port = createHarnessOutputPort(sessionId, channel, deps);
  return {
    'anvio_channel__reply': async (args) => {
      await port.reply(sessionId, String(args.text ?? ''));
      return 'ok';
    },
    'anvio_channel__edit': async (args) => {
      await port.edit(sessionId, String(args.messageId ?? ''), String(args.text ?? ''));
      return 'ok';
    },
    'anvio_channel__set_status': async (args) => {
      await port.setStatus(sessionId, String(args.status ?? 'working'));
      return 'ok';
    },
    'anvio_channel__request_approval': async (args) => {
      const id = await port.requestApproval(sessionId, String(args.summary ?? ''));
      return id;
    },
  };
}

export function harnessToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return [
    {
      name: 'anvio_channel__reply',
      description: 'Send a reply to the user on the current channel',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'anvio_channel__request_approval',
      description: 'Request human approval before a mutating action',
      inputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
    {
      name: 'anvio_channel__edit',
      description: 'Edit a previously sent channel message',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['messageId', 'text'],
      },
    },
    {
      name: 'anvio_channel__set_status',
      description: 'Set ephemeral status on the current channel (e.g. Slack presence)',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
      },
    },
  ];
}
