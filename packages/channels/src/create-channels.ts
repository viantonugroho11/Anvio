import type { ChannelAdapter, ChannelType, InboundMessage, SessionStore } from '@anvio/core';
import type { HarnessGatewayPort } from '@anvio/core';
import type { EventBusLike } from '@anvio/events';
import { EventSubjects } from '@anvio/events';
import type { ChannelHubBundle } from './channel-hub-bundle.js';
import { ChannelHub } from './channel-hub.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';
import { CliChannel } from './cli-channel.js';
import { DiscordChannel } from './discord.js';
import { RestApiChannel } from './rest-api.js';
import { SlackChannel } from './slack.js';
import { TelegramChannel } from './telegram.js';
import { WebChatChannel } from './web-chat.js';
import { WhatsAppChannel } from './whatsapp.js';

export interface SlackChannelConfig {
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  defaultAgent?: string;
}

export interface WhatsAppChannelConfig {
  enabled?: boolean;
  accessToken?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  defaultAgent?: string;
}

export interface ChannelConfig {
  telegram?: { enabled?: boolean; botToken?: string; defaultAgent?: string };
  discord?: { enabled?: boolean; botToken?: string; defaultAgent?: string };
  slack?: SlackChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
}

export interface CreateChannelHubOptions {
  sessions: SessionStore;
  eventBus: EventBusLike;
  defaultAgent: string;
  defaultUserId: string;
  channels?: ChannelConfig;
  onApproval?: (sessionId: string, requestId: string, approved: boolean) => Promise<void>;
  harness?: HarnessGatewayPort;
  hub?: ChannelHub;
}

export function createChannelHub(options: CreateChannelHubOptions): ChannelHubBundle {
  const hub = options.hub ?? new ChannelHub();
  let whatsapp: WhatsAppChannel | undefined;

  const bridge = new ChannelSessionBridge(options.sessions, {
    defaultAgent: options.defaultAgent,
    defaultUserId: options.defaultUserId,
  });

  const onInbound = createInboundHandler(
    options.eventBus,
    options.sessions,
    options.defaultAgent,
    options.harness,
  );
  const onApproval =
    options.onApproval ??
    (async (sessionId, requestId, approved) => {
      await options.eventBus.publish(EventSubjects.APPROVAL_DECIDED, 'anvio.approval.decided', {
        sessionId,
        requestId,
        approved,
      });
    });

  registerAdapter(hub, new WebChatChannel(), onInbound);
  registerAdapter(hub, new CliChannel(), onInbound);
  registerAdapter(hub, new RestApiChannel(), onInbound);

  const telegramToken =
    options.channels?.telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (options.channels?.telegram?.enabled && telegramToken) {
    registerAdapter(
      hub,
      new TelegramChannel({
        botToken: telegramToken,
        sessionBridge: bridge,
        sessions: options.sessions,
        defaultAgent: options.channels.telegram.defaultAgent ?? options.defaultAgent,
        onApproval,
      }),
      onInbound,
    );
  }

  const discordToken = options.channels?.discord?.botToken ?? process.env.DISCORD_BOT_TOKEN;
  if (options.channels?.discord?.enabled && discordToken) {
    registerAdapter(
      hub,
      new DiscordChannel({
        botToken: discordToken,
        sessionBridge: bridge,
        sessions: options.sessions,
        defaultAgent: options.channels.discord.defaultAgent ?? options.defaultAgent,
        onApproval,
      }),
      onInbound,
    );
  }

  const slackBotToken =
    options.channels?.slack?.botToken ?? process.env.SLACK_BOT_TOKEN;
  const slackAppToken =
    options.channels?.slack?.appToken ?? process.env.SLACK_APP_TOKEN;
  if (options.channels?.slack?.enabled && slackBotToken && slackAppToken) {
    registerAdapter(
      hub,
      new SlackChannel({
        botToken: slackBotToken,
        appToken: slackAppToken,
        sessionBridge: bridge,
        sessions: options.sessions,
        defaultAgent: options.channels.slack.defaultAgent ?? options.defaultAgent,
        onApproval,
      }),
      onInbound,
    );
  }

  const waAccessToken =
    options.channels?.whatsapp?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneNumberId =
    options.channels?.whatsapp?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const waVerifyToken =
    options.channels?.whatsapp?.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN ?? 'anvio-verify';

  if (options.channels?.whatsapp?.enabled && waAccessToken && waPhoneNumberId) {
    whatsapp = new WhatsAppChannel({
      accessToken: waAccessToken,
      phoneNumberId: waPhoneNumberId,
      verifyToken: waVerifyToken,
      sessionBridge: bridge,
      sessions: options.sessions,
      defaultAgent: options.channels.whatsapp.defaultAgent ?? options.defaultAgent,
      onApproval,
    });
    registerAdapter(hub, whatsapp, onInbound);
  }

  return { hub, whatsapp };
}

function registerAdapter(
  hub: ChannelHub,
  adapter: ChannelAdapter,
  onInbound: (message: InboundMessage) => Promise<void>,
): void {
  adapter.onMessage(onInbound);
  hub.register(adapter);
}

function createInboundHandler(
  eventBus: EventBusLike,
  sessions: SessionStore,
  defaultAgent: string,
  harness?: HarnessGatewayPort,
): (message: InboundMessage) => Promise<void> {
  return async (message) => {
    if (harness?.enabled) {
      const gate = await harness.handleInbound({
        channel: message.channel,
        threadId: message.channelThreadId ?? message.sessionId,
        userId: message.userId,
        content: message.content,
        sessionId: message.sessionId,
        zoneId: typeof message.metadata?.zoneId === 'string' ? message.metadata.zoneId : undefined,
        mentionedBot: message.metadata?.mentionedBot === true,
        mentionedOther: message.metadata?.mentionedOther === true,
        metadata: message.metadata,
      });
      if (gate.decision !== 'allow') return;
    }

    const session = await sessions.get(message.sessionId);
    await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
      sessionId: message.sessionId,
      userId: message.userId,
      agentId: session?.agentName ?? defaultAgent,
      content: message.content,
      channel: message.channel,
      detached: true,
    });
  };
}

export type { ChannelType, ChannelHubBundle };
