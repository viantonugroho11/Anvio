import type { ChannelHealthReport, ChannelType } from '@anvio/core';
import type { ChannelConfig } from './create-channels.js';

const BUILTIN_CHANNELS: ChannelType[] = ['cli', 'web-chat', 'rest'];

const OPTIONAL_CHANNELS: ChannelType[] = ['telegram', 'discord', 'slack', 'whatsapp'];

function report(
  channel: ChannelType,
  status: ChannelHealthReport['status'],
  message: string,
  extra?: Partial<ChannelHealthReport>,
): ChannelHealthReport {
  return { channel, status, message, ...extra };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, latencyMs: Math.round(performance.now() - start) };
}

function isEnabled(config: ChannelConfig | undefined, key: keyof ChannelConfig): boolean {
  const section = config?.[key];
  return section?.enabled === true;
}

export async function probeAllChannels(config?: ChannelConfig): Promise<ChannelHealthReport[]> {
  const results: ChannelHealthReport[] = [];

  for (const channel of BUILTIN_CHANNELS) {
    results.push(probeBuiltin(channel));
  }

  results.push(await probeTelegram(config));
  results.push(await probeDiscord(config));
  results.push(await probeSlack(config));
  results.push(await probeWhatsApp(config));

  return results;
}

function probeBuiltin(channel: ChannelType): ChannelHealthReport {
  switch (channel) {
    case 'cli':
      return report('cli', 'healthy', 'Built-in transport — always available');
    case 'web-chat':
      return report('web-chat', 'healthy', 'Built-in — requires gateway on :3001/ws', {
        details: { gatewayPath: '/ws', defaultPort: 3001 },
      });
    case 'rest':
      return report('rest', 'healthy', 'Built-in — requires API on :3000/api', {
        details: { apiPrefix: '/api', defaultPort: 3000 },
      });
    default:
      return report(channel, 'disabled', 'Unknown built-in channel');
  }
}

async function probeTelegram(config?: ChannelConfig): Promise<ChannelHealthReport> {
  const channel: ChannelType = 'telegram';
  if (!isEnabled(config, 'telegram')) {
    return report(channel, 'disabled', 'Not enabled — set spec.channels.telegram.enabled: true');
  }

  const token = config?.telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return report(channel, 'misconfigured', 'Missing TELEGRAM_BOT_TOKEN or spec.channels.telegram.botToken');
  }

  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const json = (await res.json()) as {
        ok: boolean;
        description?: string;
        result?: { username?: string; id?: number };
      };
      if (!json.ok) throw new Error(json.description ?? 'getMe failed');
      return json.result;
    });
    return report(channel, 'healthy', `Connected as @${result?.username ?? 'bot'}`, {
      latencyMs,
      details: { botId: result?.id, username: result?.username },
    });
  } catch (error) {
    return report(channel, 'unreachable', error instanceof Error ? error.message : 'Probe failed');
  }
}

async function probeDiscord(config?: ChannelConfig): Promise<ChannelHealthReport> {
  const channel: ChannelType = 'discord';
  if (!isEnabled(config, 'discord')) {
    return report(channel, 'disabled', 'Not enabled — set spec.channels.discord.enabled: true');
  }

  const token = config?.discord?.botToken ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return report(channel, 'misconfigured', 'Missing DISCORD_BOT_TOKEN or spec.channels.discord.botToken');
  }

  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${res.status} ${err}`);
      }
      return res.json() as Promise<{ username?: string; id?: string }>;
    });
    return report(channel, 'healthy', `Connected as ${result.username ?? 'bot'}`, {
      latencyMs,
      details: { botId: result.id, username: result.username },
    });
  } catch (error) {
    return report(channel, 'unreachable', error instanceof Error ? error.message : 'Probe failed');
  }
}

async function probeSlack(config?: ChannelConfig): Promise<ChannelHealthReport> {
  const channel: ChannelType = 'slack';
  if (!isEnabled(config, 'slack')) {
    return report(channel, 'disabled', 'Not enabled — set spec.channels.slack.enabled: true');
  }

  const botToken = config?.slack?.botToken ?? process.env.SLACK_BOT_TOKEN;
  const appToken = config?.slack?.appToken ?? process.env.SLACK_APP_TOKEN;

  if (!botToken) {
    return report(channel, 'misconfigured', 'Missing SLACK_BOT_TOKEN or spec.channels.slack.botToken');
  }
  if (!appToken) {
    return report(channel, 'misconfigured', 'Missing SLACK_APP_TOKEN (Socket Mode requires xapp- token)');
  }

  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        user?: string;
        team?: string;
      };
      if (!json.ok) throw new Error(json.error ?? 'auth.test failed');
      return json;
    });
    return report(channel, 'healthy', `Connected as ${result.user ?? 'bot'} (${result.team ?? 'workspace'})`, {
      latencyMs,
      details: { user: result.user, team: result.team, socketMode: true },
    });
  } catch (error) {
    return report(channel, 'unreachable', error instanceof Error ? error.message : 'Probe failed');
  }
}

async function probeWhatsApp(config?: ChannelConfig): Promise<ChannelHealthReport> {
  const channel: ChannelType = 'whatsapp';
  if (!isEnabled(config, 'whatsapp')) {
    return report(channel, 'disabled', 'Not enabled — set spec.channels.whatsapp.enabled: true');
  }

  const accessToken = config?.whatsapp?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = config?.whatsapp?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken =
    config?.whatsapp?.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN ?? 'anvio-verify';

  if (!accessToken) {
    return report(channel, 'misconfigured', 'Missing WHATSAPP_ACCESS_TOKEN');
  }
  if (!phoneNumberId) {
    return report(channel, 'misconfigured', 'Missing WHATSAPP_PHONE_NUMBER_ID');
  }

  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${res.status} ${err}`);
      }
      return res.json() as Promise<{ id?: string; display_phone_number?: string; verified_name?: string }>;
    });

    const phone = result.display_phone_number ?? phoneNumberId;
    return report(channel, 'degraded', `API reachable (${phone}) — webhook requires running API`, {
      latencyMs,
      details: {
        phoneNumberId: result.id ?? phoneNumberId,
        displayPhoneNumber: result.display_phone_number,
        verifiedName: result.verified_name,
        verifyToken,
        webhookPath: '/api/channels/whatsapp/webhook',
      },
    });
  } catch (error) {
    return report(channel, 'unreachable', error instanceof Error ? error.message : 'Probe failed');
  }
}

export function summarizeChannelHealth(reports: ChannelHealthReport[]): {
  healthy: number;
  degraded: number;
  disabled: number;
  misconfigured: number;
  unreachable: number;
} {
  const summary = { healthy: 0, degraded: 0, disabled: 0, misconfigured: 0, unreachable: 0 };
  for (const r of reports) {
    summary[r.status] += 1;
  }
  return summary;
}

export { OPTIONAL_CHANNELS, BUILTIN_CHANNELS };
