// Late-bound slash commands that need subsystems constructed after the
// initial SlashCommandRegistry is handed to the channel hub. Registered
// from createPlatform once every dependency exists; the registry's
// `register()` method takes them one by one.
//
// Kept lean on purpose — commands here must be reliably available on
// every workspace. Anything that needs a workspace file that might not
// exist (kanban board, workflow definition) gets a stub reply rather
// than a hard error, so the picker entry is never a dead click.

import type { SlashCommandRegistry } from '@anvio/core';
import type { AutomationEngine } from '@anvio/automation';
import type { Workspace } from '@anvio/workspace';
import { probeAllChannels, summarizeChannelHealth } from '@anvio/channels';

export interface ExtrasOptions {
  registry: SlashCommandRegistry;
  workspace: Workspace;
  automation: AutomationEngine;
}

export function registerPlatformExtras(opts: ExtrasOptions): void {
  const { registry } = opts;

  registry.register({
    name: 'sessions',
    description: 'List recent sessions',
    handler: async () => {
      const sessions = await opts.workspace.sessions.list();
      if (sessions.length === 0) return { swallow: true, reply: 'No sessions.' };
      const lines = sessions
        .slice(-10)
        .map(
          (s) =>
            `  ${s.id.slice(0, 12)} · ${s.agentName} · ${s.channel} · ${s.status} · ${s.messages.length} msgs`,
        );
      return { swallow: true, reply: `Sessions (last ${lines.length}):\n${lines.join('\n')}` };
    },
  });

  registry.register({
    name: 'channels',
    description: 'Channel adapter health',
    handler: async () => {
      try {
        const report = await probeAllChannels(opts.workspace.config.spec.channels ?? {});
        const summary = summarizeChannelHealth(report);
        // summarizeChannelHealth returns { healthy, degraded, disabled, misconfigured, unreachable }
        // — render as a short line rather than raw JSON.
        return {
          swallow: true,
          reply: [
            `healthy: ${summary.healthy}`,
            `degraded: ${summary.degraded}`,
            `disabled: ${summary.disabled}`,
            `misconfigured: ${summary.misconfigured}`,
            `unreachable: ${summary.unreachable}`,
          ].join(' · '),
        };
      } catch (error) {
        return {
          swallow: true,
          reply: `Channel probe failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  registry.register({
    name: 'automations',
    description: 'List cron/automation jobs',
    handler: async () => {
      const items = await opts.automation.list();
      if (items.length === 0) return { swallow: true, reply: 'No automations.' };
      return {
        swallow: true,
        reply: items
          .map(
            (a) =>
              `  ${a.metadata.slug} [${a.metadata.enabled ? 'on' : 'off'}] ${a.spec.trigger.type}`,
          )
          .join('\n'),
      };
    },
  });
}
