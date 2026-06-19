import type { ChannelAdapter, ChannelType, InboundMessage, SessionStore } from '@anvio/core';
import type { HarnessGatewayPort } from '@anvio/core';
import type { EventBusLike } from '@anvio/events';
import { EventSubjects } from '@anvio/events';
import type { ChannelHubBundle } from './channel-hub-bundle.js';
import { ChannelHub } from './channel-hub.js';
import { ChannelSessionBridge } from './channel-session-bridge.js';
import { CliChannel } from './cli-channel.js';
import { DiscordChannel } from './discord.js';
import { EmailChannel } from './email.js';
import { GoogleChatChannel } from './google-chat.js';
import { MatrixChannel } from './matrix.js';
import { RestApiChannel } from './rest-api.js';
import { SignalChannel } from './signal.js';
import { SlackChannel } from './slack.js';
import { TeamsChannel } from './teams.js';
import { TelegramChannel } from './telegram.js';
import { WebChatChannel } from './web-chat.js';
import { WhatsAppChannel } from './whatsapp.js';
import { MattermostChannel } from './mattermost.js';
import { VoicePipeline } from '@anvio/voice';
import type { ChannelVoiceOptions } from '@anvio/voice';

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
  voice?: ChannelVoiceOptions;
  telegram?: { enabled?: boolean; botToken?: string; defaultAgent?: string; voice?: ChannelVoiceOptions };
  discord?: { enabled?: boolean; botToken?: string; defaultAgent?: string; voice?: ChannelVoiceOptions };
  slack?: SlackChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
  teams?: {
    enabled?: boolean;
    appId?: string;
    appPassword?: string;
    serviceUrl?: string;
    defaultAgent?: string;
  };
  matrix?: {
    enabled?: boolean;
    homeserverUrl?: string;
    accessToken?: string;
    userId?: string;
    roomId?: string;
    defaultAgent?: string;
  };
  email?: {
    enabled?: boolean;
    smtpHost?: string;
    username?: string;
    password?: string;
    defaultAgent?: string;
  };
  signal?: {
    enabled?: boolean;
    signalCliPath?: string;
    phoneNumber?: string;
    defaultAgent?: string;
  };
  googleChat?: {
    enabled?: boolean;
    webhookUrl?: string;
    defaultAgent?: string;
  };
  mattermost?: {
    enabled?: boolean;
    serverUrl?: string;
    botToken?: string;
    defaultAgent?: string;
  };
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

  const voicePipeline = resolveVoicePipeline(options.channels);

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
        voice: mergeVoiceOptions(options.channels, options.channels.telegram.voice),
        voicePipeline,
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
        voice: mergeVoiceOptions(options.channels, options.channels.discord.voice),
        voicePipeline,
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

  const bridgeOpts = { sessionBridge: bridge, sessions: options.sessions, onApproval };

  registerAdapter(
    hub,
    new TeamsChannel({
      ...bridgeOpts,
      appId: options.channels?.teams?.appId ?? process.env.TEAMS_APP_ID,
      appPassword: options.channels?.teams?.appPassword ?? process.env.TEAMS_APP_PASSWORD,
      serviceUrl: options.channels?.teams?.serviceUrl ?? process.env.TEAMS_SERVICE_URL,
      defaultAgent: options.channels?.teams?.defaultAgent ?? options.defaultAgent,
    }),
    onInbound,
  );

  registerAdapter(
    hub,
    new MatrixChannel({
      ...bridgeOpts,
      homeserverUrl: options.channels?.matrix?.homeserverUrl ?? process.env.MATRIX_HOMESERVER_URL,
      accessToken: options.channels?.matrix?.accessToken ?? process.env.MATRIX_ACCESS_TOKEN,
      userId: options.channels?.matrix?.userId ?? process.env.MATRIX_USER_ID,
      roomId: options.channels?.matrix?.roomId ?? process.env.MATRIX_ROOM_ID,
      defaultAgent: options.channels?.matrix?.defaultAgent ?? options.defaultAgent,
    }),
    onInbound,
  );

  if (options.channels?.email?.enabled) {
    registerAdapter(
      hub,
      new EmailChannel({
        ...bridgeOpts,
        smtpHost: options.channels.email.smtpHost ?? process.env.EMAIL_SMTP_HOST,
        username: options.channels.email.username ?? process.env.EMAIL_USERNAME,
        password: options.channels.email.password ?? process.env.EMAIL_PASSWORD,
        defaultAgent: options.channels.email.defaultAgent ?? options.defaultAgent,
      }),
      onInbound,
    );
  }

  if (options.channels?.signal?.enabled) {
    registerAdapter(
      hub,
      new SignalChannel({
        ...bridgeOpts,
        signalCliPath: options.channels.signal.signalCliPath ?? process.env.SIGNAL_CLI_PATH,
        phoneNumber: options.channels.signal.phoneNumber ?? process.env.SIGNAL_PHONE_NUMBER,
        defaultAgent: options.channels.signal.defaultAgent ?? options.defaultAgent,
      }),
      onInbound,
    );
  }

  const googleChatWebhook =
    options.channels?.googleChat?.webhookUrl ?? process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (options.channels?.googleChat?.enabled && googleChatWebhook) {
    registerAdapter(
      hub,
      new GoogleChatChannel({
        ...bridgeOpts,
        webhookUrl: googleChatWebhook,
        defaultAgent: options.channels.googleChat.defaultAgent ?? options.defaultAgent,
      }),
      onInbound,
    );
  }

  const mattermostUrl =
    options.channels?.mattermost?.serverUrl ?? process.env.MATTERMOST_SERVER_URL;
  const mattermostToken =
    options.channels?.mattermost?.botToken ?? process.env.MATTERMOST_BOT_TOKEN;
  if (options.channels?.mattermost?.enabled && mattermostUrl && mattermostToken) {
    registerAdapter(
      hub,
      new MattermostChannel({
        serverUrl: mattermostUrl,
        botToken: mattermostToken,
        sessionBridge: bridge,
        sessions: options.sessions,
        defaultAgent: options.channels.mattermost.defaultAgent ?? options.defaultAgent,
        onApproval,
      }),
      onInbound,
    );
  }

  return { hub, whatsapp };
}

function resolveVoicePipeline(channels?: ChannelConfig): VoicePipeline | undefined {
  const globalVoice = channels?.voice?.enabled === true;
  const telegramVoice = channels?.telegram?.voice?.enabled === true;
  const discordVoice = channels?.discord?.voice?.enabled === true;
  const envVoice = process.env.ANVIO_CHANNEL_VOICE === '1';
  if (globalVoice || telegramVoice || discordVoice || envVoice) {
    return new VoicePipeline();
  }
  return undefined;
}

function mergeVoiceOptions(
  channels: ChannelConfig | undefined,
  channelVoice?: ChannelVoiceOptions,
): ChannelVoiceOptions | undefined {
  const enabled =
    channelVoice?.enabled === true ||
    channels?.voice?.enabled === true ||
    process.env.ANVIO_CHANNEL_VOICE === '1';
  if (!enabled) return undefined;
  return {
    enabled: true,
    replyWithAudio: channelVoice?.replyWithAudio ?? channels?.voice?.replyWithAudio,
  };
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
