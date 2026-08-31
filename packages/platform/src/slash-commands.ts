// Platform-side factory: composes a SlashCommandRegistry from workspace
// content and the built-in commands. See ADR-0023.
//
// Wired into createPlatform and consumed by every channel adapter that has
// slash-prefixed traffic. Runs BEFORE the harness gate so `/help` in a DM
// on a restricted-zone workspace still gets a reply, rather than being
// silently dropped.

import type {
  AgentDefinition,
  ConfigLoader,
  SessionStore,
  SkillDefinition,
  SlashCommand,
  SlashCommandRegistry,
  SlashCommandResult,
  StoredSession,
} from '@anvio/core';
import type { LearningEngine } from '@anvio/learning';

export interface SlashCommandFactoryOptions {
  loader: ConfigLoader;
  sessions: SessionStore;
  defaultAgent: string;
  learningEngine?: LearningEngine;
  workspacePath: string;
}

/**
 * Build the registry the platform hands out. Keep it small on purpose —
 * every command here is one that has to work on every channel.
 */
export function createSlashCommandRegistry(
  options: SlashCommandFactoryOptions,
): SlashCommandRegistry {
  const commands = new Map<string, SlashCommand>();

  const register = (cmd: SlashCommand): void => {
    commands.set(cmd.name.toLowerCase(), cmd);
  };

  register({
    name: 'help',
    description: 'Show available commands',
    handler: async () => ({
      swallow: true,
      reply: [...commands.values()]
        .map((c) => `/${c.name} — ${c.description}`)
        .join('\n'),
    }),
  });

  register({
    name: 'whoami',
    description: 'Show current session, thread, and active agent',
    handler: async (ctx) => {
      const stored = await options.sessions.get(ctx.sessionId);
      return {
        swallow: true,
        reply: [
          `Session: ${ctx.sessionId}`,
          `Thread:  ${ctx.threadId}`,
          `User:    ${ctx.userId}`,
          `Agent:   ${stored?.agentName ?? options.defaultAgent}`,
          `Channel: ${ctx.channel}${ctx.isDm ? ' (dm)' : ''}`,
        ].join('\n'),
      };
    },
  });

  register({
    name: 'agents',
    description: 'List workspace agents',
    handler: async (ctx) => {
      const slugs = await options.loader.listAgents();
      const stored = await options.sessions.get(ctx.sessionId);
      const active = stored?.agentName ?? options.defaultAgent;
      const lines = await Promise.all(
        slugs.map(async (slug) => {
          const marker = slug === active ? '● ' : '  ';
          try {
            const agent = (await options.loader.loadAgent(slug)) as AgentDefinition;
            return `${marker}${slug} — ${agent.spec.description}`;
          } catch {
            return `${marker}${slug}`;
          }
        }),
      );
      return {
        swallow: true,
        reply: lines.length > 0 ? lines.join('\n') : 'No agents in workspace.',
      };
    },
  });

  register({
    name: 'agent',
    description: 'Switch active agent for this thread: /agent <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) {
        return { swallow: true, reply: 'Usage: /agent <slug>' };
      }
      const known = await options.loader.listAgents();
      if (!known.includes(slug)) {
        return {
          swallow: true,
          reply: `Unknown agent: ${slug}. /agents to list.`,
        };
      }
      return {
        swallow: true,
        reply: `Active agent set to ${slug}.`,
        updateSession: { agentName: slug },
      };
    },
  });

  register({
    name: 'skills',
    description: 'List available skills',
    handler: async () => {
      const slugs = await options.loader.listSkills();
      const lines = await Promise.all(
        slugs.map(async (slug) => {
          try {
            const s = (await options.loader.loadSkill(slug)) as SkillDefinition;
            return `  ${slug} — ${s.spec.description}`;
          } catch {
            return `  ${slug}`;
          }
        }),
      );
      return {
        swallow: true,
        reply: lines.length > 0 ? lines.join('\n') : 'No skills in workspace.',
      };
    },
  });

  register({
    name: 'reset',
    description: 'Clear this thread and start a fresh session',
    handler: async () => ({
      swallow: true,
      reply: 'Session reset. Next message starts fresh.',
      updateSession: { reset: true },
    }),
  });

  if (options.learningEngine) {
    const learning = options.learningEngine;
    register({
      name: 'drafts',
      description: 'List pending skill drafts from this workspace',
      handler: async () => {
        const files = await learning.listDrafts();
        return {
          swallow: true,
          reply:
            files.length > 0
              ? `Drafts (${files.length}):\n${files.map((f) => `  ${f}`).join('\n')}`
              : 'No skill drafts pending.',
        };
      },
    });

    register({
      name: 'draft',
      description: 'Show a draft: /draft <slug>',
      handler: async (ctx) => {
        const slug = ctx.argsList[0];
        if (!slug) return { swallow: true, reply: 'Usage: /draft <slug>' };
        const draft = await learning.getDraft(slug);
        if (!draft) return { swallow: true, reply: `Draft not found: ${slug}` };
        // Cap the body — chat surfaces choke on multi-KB blocks and the
        // reviewer usually just wants the frontmatter to decide.
        const preview = draft.content.length > 2000
          ? `${draft.content.slice(0, 2000)}\n… (truncated, ${draft.content.length - 2000} more chars)`
          : draft.content;
        return { swallow: true, reply: preview };
      },
    });

    register({
      name: 'discard',
      description: 'Soft-delete a skill draft: /discard <slug>',
      handler: async (ctx) => {
        const slug = ctx.argsList[0];
        if (!slug) return { swallow: true, reply: 'Usage: /discard <slug>' };
        const result = await learning.discardDraft(slug);
        return {
          swallow: true,
          reply: result
            ? `Discarded → ${result.path}`
            : `Draft not found: ${slug}`,
        };
      },
    });

    register({
      name: 'promote',
      description: 'Promote a skill draft to workspace/skills: /promote <slug> [--force]',
      handler: async (ctx) => {
        const slug = ctx.argsList[0];
        if (!slug) return { swallow: true, reply: 'Usage: /promote <slug> [--force]' };
        const force = ctx.argsList.includes('--force');
        try {
          const result = await learning.promoteDraft(slug, options.workspacePath, { force });
          if (result.diff) {
            return {
              swallow: true,
              reply: [
                `Refusing to overwrite ${result.path} — re-run with --force to apply.`,
                '',
                result.diff,
              ].join('\n'),
            };
          }
          const verb = result.alreadyExisted ? 'Overwrote' : 'Promoted';
          return { swallow: true, reply: `${verb} → ${result.path}` };
        } catch (error) {
          return {
            swallow: true,
            reply: `Promote failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    register({
      name: 'capture',
      description: 'Force-extract a skill from this session (bypasses the auto-gate)',
      handler: async (ctx) => {
        const stored = await options.sessions.get(ctx.sessionId);
        if (!stored) return { swallow: true, reply: 'No session to capture from.' };
        const draft = await learning.captureFromSession({
          sessionId: stored.id,
          userId: stored.userId,
          agentId: stored.agentName,
          messages: stored.messages,
          channel: stored.channel,
          force: true,
        });
        return {
          swallow: true,
          reply: draft
            ? `Captured draft: ${draft.slug}\n  ${draft.path}\nUse /promote ${draft.slug} to save.`
            : 'Nothing to capture — the session is too short.',
        };
      },
    });
  }

  return {
    list(): SlashCommand[] {
      return [...commands.values()];
    },
    async dispatch(input, ctx): Promise<SlashCommandResult | null> {
      if (!input.startsWith('/')) return null;
      const [firstToken, ...rest] = input.slice(1).split(/\s+/);
      const cleaned = (firstToken ?? '').replace(/@\S+$/, '').toLowerCase();
      if (!cleaned) return null;
      const cmd = commands.get(cleaned);
      if (!cmd) return null;
      const argsList = rest.filter((s) => s.length > 0);
      const argsRaw = input.slice(1 + firstToken!.length).trim();
      return cmd.handler({ ...ctx, argsRaw, argsList });
    },
  };
}

/** Apply session-state changes returned by a command handler. */
export async function applySlashUpdate(
  sessions: SessionStore,
  sessionId: string,
  update: SlashCommandResult['updateSession'],
): Promise<void> {
  if (!update) return;
  const patch: Partial<StoredSession> = {};
  if (update.agentName) patch.agentName = update.agentName;
  if (update.reset) {
    patch.messages = [];
    const stored = await sessions.get(sessionId);
    patch.metadata = { ...stored?.metadata, agentRunCheckpoint: undefined };
  }
  if (Object.keys(patch).length > 0) {
    await sessions.update(sessionId, patch);
  }
}
