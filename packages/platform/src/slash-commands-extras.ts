// Late-bound slash commands (ADR-0024).
//
// Registered after createPlatform's wiring completes so subsystems that
// are built late — automation, workflow registry, blueprint catalog,
// kanban engine, tool gateway, hook engine, event bus — can each surface
// a `/foo` on every chat channel via the same registry the platform
// already handed to createChannelHub.
//
// Handlers stay narrow: read-only introspection, session-scoped control
// (status/history/stop/detach/checkpoint), per-thread runtime/provider/
// model overrides, and lightweight debug. Full mutation (`/new`, `/edit`,
// `/rm`) is deferred to ADR-0025.

import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AgentDefinition,
  ChannelHubPort,
  MemoryProvider,
  ModelProviderId,
  SlashCommandRegistry,
} from '@anvio/core';
import type { AgentRuntimeOverride } from './session-overrides.js';
import type { AutomationEngine } from '@anvio/automation';
import type { HookEngine } from '@anvio/hooks';
import type { ToolGateway } from '@anvio/tools';
import type { WorkflowRegistry } from '@anvio/workflows';
import type { KanbanEngine } from '@anvio/core';
import type { Workspace } from '@anvio/workspace';
import type { BlueprintCatalogRegistry } from '@anvio/blueprints';
import type { PersonaService } from '@anvio/personas';
import type { EventBusLike } from '@anvio/events';
import { EventSubjects } from '@anvio/events';
import { probeAllChannels, summarizeChannelHealth } from '@anvio/channels';
import type { HarnessGateway } from '@anvio/harness';
import { resolveChannelProfile } from '@anvio/harness';
import { KnowledgeBaseStore } from '@anvio/knowledge';
import { aggregateTokenUsage, readTokenUsageAudit } from './usage-stats.js';

export interface ExtrasOptions {
  registry: SlashCommandRegistry;
  workspace: Workspace;
  channelHub: ChannelHubPort;
  automation: AutomationEngine;
  hooks: HookEngine;
  toolGateway: ToolGateway;
  workflowRegistry: WorkflowRegistry;
  blueprintCatalog: BlueprintCatalogRegistry;
  kanban: KanbanEngine;
  personas: PersonaService;
  eventBus: EventBusLike;
  version?: string;
  memory?: MemoryProvider;
  harness?: HarnessGateway;
}

const VALID_RUNTIMES: AgentRuntimeOverride[] = [
  'local',
  'cursor',
  'claude-code',
  'codex',
  'antigravity',
];

const KNOWN_PROVIDERS: ModelProviderId[] = [
  'anthropic',
  'openai',
  'deepseek',
  'openrouter',
  'gemini',
  'perplexity',
  'cohere',
  'huggingface',
  'together',
  'groq',
  'fireworks',
  'mistral',
  'xai',
  'nebius',
  'novita',
  'lambda',
  'moonshot',
  'zhipu',
  'custom',
] as unknown as ModelProviderId[];

export function registerPlatformExtras(opts: ExtrasOptions): void {
  const { registry, workspace, eventBus } = opts;

  // ---------------- Introspection (read) ----------------

  registry.register({
    name: 'sessions',
    description: 'List recent sessions',
    handler: async () => {
      const sessions = await workspace.sessions.list();
      if (sessions.length === 0) return { swallow: true, reply: 'No sessions.' };
      return {
        swallow: true,
        reply: sessions
          .slice(-10)
          .map(
            (s) =>
              `  ${s.id.slice(0, 12)} · ${s.agentName} · ${s.channel} · ${s.status} · ${s.messages.length} msgs`,
          )
          .join('\n'),
      };
    },
  });

  registry.register({
    name: 'session',
    description: 'Show one session: /session <id>',
    handler: async (ctx) => {
      const target = ctx.argsList[0] ?? ctx.sessionId;
      const s = await workspace.sessions.get(target);
      if (!s) return { swallow: true, reply: `Session not found: ${target}` };
      const last = s.messages.slice(-3);
      return {
        swallow: true,
        reply: [
          `session ${s.id}`,
          `agent: ${s.agentName} · channel: ${s.channel} · status: ${s.status}`,
          `messages: ${s.messages.length}`,
          last.length
            ? `last:\n${last.map((m) => `  ${m.role}: ${m.content.slice(0, 200)}`).join('\n')}`
            : undefined,
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n'),
      };
    },
  });

  registry.register({
    name: 'channels',
    description: 'Channel adapter health',
    handler: async () => {
      try {
        const report = await probeAllChannels(workspace.config.spec.channels ?? {});
        const summary = summarizeChannelHealth(report);
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
          reply: `Channel probe failed: ${errMsg(error)}`,
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

  registry.register({
    name: 'personas',
    description: 'List workspace personas',
    handler: async () => {
      const slugs = await workspace.loader.listPersonas();
      if (slugs.length === 0) return { swallow: true, reply: 'No personas.' };
      return { swallow: true, reply: slugs.map((s) => `  ${s}`).join('\n') };
    },
  });

  registry.register({
    name: 'persona',
    description: 'Show a persona: /persona <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /persona <slug>' };
      try {
        const p = await opts.personas.getBySlug(slug);
        return {
          swallow: true,
          reply: [
            `${slug} — ${p.name ?? slug}`,
            p.description ? p.description : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Persona load failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'workflows',
    description: 'List workflow definitions',
    handler: async () => {
      const items = await opts.workflowRegistry.listAll();
      if (items.length === 0) return { swallow: true, reply: 'No workflows.' };
      return {
        swallow: true,
        reply: items.map((i) => `  ${i.slug} [${i.source}]`).join('\n'),
      };
    },
  });

  registry.register({
    name: 'workflow',
    description: 'Show a workflow: /workflow <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /workflow <slug>' };
      try {
        const def = await opts.workflowRegistry.load(slug);
        const nodes = def.spec.nodes ?? [];
        return {
          swallow: true,
          reply: [
            `${slug} — ${def.spec.description ?? ''}`,
            nodes.length
              ? `nodes:\n${nodes.map((n: { id: string }) => `  - ${n.id}`).join('\n')}`
              : 'nodes: (none)',
          ].join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Workflow load failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'blueprints',
    description: 'List blueprint scaffolds',
    handler: async () => {
      const items = await opts.blueprintCatalog.listAll();
      if (items.length === 0) return { swallow: true, reply: 'No blueprints.' };
      return {
        swallow: true,
        reply: items.map((i) => `  ${i.slug} [${i.source}]`).join('\n'),
      };
    },
  });

  registry.register({
    name: 'blueprint',
    description: 'Show a blueprint: /blueprint <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /blueprint <slug>' };
      try {
        const def = await opts.blueprintCatalog.load(slug);
        return {
          swallow: true,
          reply: [
            `${slug}`,
            def.spec.description ? def.spec.description : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Blueprint load failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'kanban',
    description: 'List kanban boards',
    handler: async () => {
      try {
        const boards = await opts.kanban.listBoards();
        if (boards.length === 0) return { swallow: true, reply: 'No kanban boards.' };
        return {
          swallow: true,
          reply: boards
            .map((b) => `  ${b.metadata.slug} — ${b.spec.columns.join('|')}`)
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Kanban read failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'tools',
    description: 'List built-in tools available to agents',
    handler: async () => {
      const names = opts.toolGateway.listTools();
      if (names.length === 0) return { swallow: true, reply: 'No tools registered.' };
      return { swallow: true, reply: names.map((n) => `  ${n}`).join('\n') };
    },
  });

  registry.register({
    name: 'hooks',
    description: 'List event hooks',
    handler: async () => {
      const items = opts.hooks.list();
      if (items.length === 0) return { swallow: true, reply: 'No hooks configured.' };
      return {
        swallow: true,
        reply: items
          .map((h) => `  ${h.event} → [${h.handlers.map((x) => x.type).join(', ')}]`)
          .join('\n'),
      };
    },
  });

  registry.register({
    name: 'skill',
    description: 'Show a skill: /skill <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /skill <slug>' };
      try {
        const s = await workspace.loader.loadSkill(slug) as {
          spec: { name?: string; description?: string; instructions?: string };
        };
        const instructions = (s.spec.instructions ?? '').slice(0, 1800);
        return {
          swallow: true,
          reply: [
            `${slug} — ${s.spec.name ?? ''}`,
            s.spec.description,
            instructions ? '\n' + instructions : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Skill not found: ${slug} (${errMsg(error)})` };
      }
    },
  });

  // ---------------- Session control ----------------

  registry.register({
    name: 'status',
    description: 'Show status of the current session',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };
      const meta = (s.metadata ?? {}) as Record<string, unknown>;
      const override =
        meta.providerOverride || meta.modelOverride || meta.runtimeOverride
          ? `overrides: provider=${meta.providerOverride ?? '-'} model=${meta.modelOverride ?? '-'} runtime=${meta.runtimeOverride ?? '-'}`
          : 'overrides: (none)';
      return {
        swallow: true,
        reply: [
          `session ${s.id}`,
          `agent: ${s.agentName} · status: ${s.status} · messages: ${s.messages.length}`,
          s.pendingApproval ? `pending approval: ${s.pendingApproval.toolName}` : 'no pending approval',
          override,
        ].join('\n'),
      };
    },
  });

  registry.register({
    name: 'history',
    description: 'Show last N turns: /history [n]',
    handler: async (ctx) => {
      const n = Math.min(50, Math.max(1, parseInt(ctx.argsList[0] ?? '10', 10) || 10));
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };
      const tail = s.messages.slice(-n);
      if (tail.length === 0) return { swallow: true, reply: 'No history.' };
      return {
        swallow: true,
        reply: tail
          .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
          .join('\n---\n'),
      };
    },
  });

  registry.register({
    name: 'stop',
    description: 'Request stop of the current run',
    handler: async (ctx) => {
      await eventBus.publish(EventSubjects.AGENT_RUN_STOP_REQUESTED, 'anvio.agent.run.stop_requested', {
        sessionId: ctx.sessionId,
      });
      return { swallow: true, reply: 'Stop requested.' };
    },
  });

  registry.register({
    name: 'detach',
    description: 'Flip this session to background/detached',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };
      await workspace.sessions.update(ctx.sessionId, { detached: true });
      return { swallow: true, reply: 'Session detached. Runs continue in the background.' };
    },
  });

  registry.register({
    name: 'checkpoint',
    description: 'Save a labeled checkpoint of this session: /checkpoint [label]',
    handler: async (ctx) => {
      const label = ctx.argsList.join(' ').trim() || `manual-${new Date().toISOString().slice(0, 19)}`;
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };
      const nextMeta = {
        ...(s.metadata ?? {}),
        checkpointLabel: label,
        agentRunCheckpoint: {
          label,
          savedAt: new Date().toISOString(),
          messages: s.messages.length,
        },
      };
      await workspace.sessions.update(ctx.sessionId, { metadata: nextMeta });
      return { swallow: true, reply: `Checkpoint saved: ${label}` };
    },
  });

  // ---------------- Per-thread overrides (the ADR's headline) ----------------

  registry.register({
    name: 'providers',
    description: 'List known model providers',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      const active = (s?.metadata?.providerOverride as string | undefined) ?? 'agent-default';
      return {
        swallow: true,
        reply: [
          `active for this session: ${active}`,
          '',
          ...KNOWN_PROVIDERS.map((p) => `  ${p}`),
        ].join('\n'),
      };
    },
  });

  registry.register({
    name: 'provider',
    description: 'Set model provider for THIS session: /provider <slug>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /provider <slug>' };
      if (!KNOWN_PROVIDERS.includes(slug as ModelProviderId)) {
        return {
          swallow: true,
          reply: `Unknown provider: ${slug}. /providers to list.`,
        };
      }
      await patchSessionMeta(workspace, ctx.sessionId, { providerOverride: slug });
      return { swallow: true, reply: `Provider set to ${slug} for this session.` };
    },
  });

  registry.register({
    name: 'model',
    description: 'Set model id for THIS session: /model <id>',
    handler: async (ctx) => {
      const id = ctx.argsList[0];
      if (!id) return { swallow: true, reply: 'Usage: /model <id>' };
      await patchSessionMeta(workspace, ctx.sessionId, { modelOverride: id });
      return { swallow: true, reply: `Model set to ${id} for this session.` };
    },
  });

  registry.register({
    name: 'runtime',
    description: 'Set runtime for THIS session: /runtime <local|claude-code|cursor|codex|antigravity>',
    handler: async (ctx) => {
      const slug = ctx.argsList[0];
      if (!slug) return { swallow: true, reply: 'Usage: /runtime <slug>' };
      if (!VALID_RUNTIMES.includes(slug as AgentRuntimeOverride)) {
        return {
          swallow: true,
          reply: `Unknown runtime: ${slug}. Valid: ${VALID_RUNTIMES.join(', ')}.`,
        };
      }
      await patchSessionMeta(workspace, ctx.sessionId, { runtimeOverride: slug });
      return { swallow: true, reply: `Runtime set to ${slug} for this session.` };
    },
  });

  registry.register({
    name: 'routing',
    description: 'Show effective provider/model/runtime for this session',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };
      let agent: AgentDefinition | undefined;
      try {
        agent = (await workspace.loader.loadAgent(s.agentName)) as AgentDefinition;
      } catch {
        agent = undefined;
      }
      const meta = (s.metadata ?? {}) as Record<string, unknown>;
      const provider = meta.providerOverride ?? agent?.spec.model.provider ?? '-';
      const model = meta.modelOverride ?? agent?.spec.model.model ?? '-';
      const runtime = meta.runtimeOverride ?? agent?.spec.runtime?.provider ?? 'local';
      return {
        swallow: true,
        reply: [
          `agent: ${s.agentName}`,
          `provider: ${provider}${meta.providerOverride ? ' (override)' : ''}`,
          `model: ${model}${meta.modelOverride ? ' (override)' : ''}`,
          `runtime: ${runtime}${meta.runtimeOverride ? ' (override)' : ''}`,
        ].join('\n'),
      };
    },
  });

  // ---------------- Debug + feedback ----------------

  registry.register({
    name: 'version',
    description: 'Anvio + workspace + node version',
    handler: async () => {
      return {
        swallow: true,
        reply: [
          `anvio: ${opts.version ?? 'unknown'}`,
          `workspace: ${path.basename(workspace.rootDir ?? '.')}`,
          `node: ${process.version}`,
        ].join('\n'),
      };
    },
  });

  registry.register({
    name: 'settings',
    description: 'Effective config for the current session',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      const spec = workspace.config.spec;
      return {
        swallow: true,
        reply: [
          `runtime.default: ${spec.runtime?.default ?? 'local'}`,
          `events.provider: ${spec.events?.provider ?? 'in-process'}`,
          `storage.provider: ${spec.storage?.provider ?? 'filesystem'}`,
          `defaultSoul: ${spec.defaultSoul ?? '-'}`,
          `session.status: ${s?.status ?? '-'}`,
          `session.detached: ${s?.detached ?? false}`,
        ].join('\n'),
      };
    },
  });

  const feedbackHandler = (kind: 'up' | 'down') => async (ctx: { sessionId: string; argsRaw: string }) => {
    const reason = ctx.argsRaw.trim();
    const line =
      JSON.stringify({
        sessionId: ctx.sessionId,
        vote: kind,
        reason: reason || undefined,
        at: new Date().toISOString(),
      }) + '\n';
    try {
      const dir = path.join(workspace.rootDir ?? '.', 'memory', 'feedback');
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, `${ctx.sessionId}.jsonl`), line, 'utf-8');
      return { swallow: true, reply: kind === 'up' ? '👍 recorded' : '👎 recorded' };
    } catch (error) {
      return { swallow: true, reply: `Feedback write failed: ${errMsg(error)}` };
    }
  };

  registry.register({
    name: 'thumbsup',
    description: 'Record positive feedback for this session',
    handler: feedbackHandler('up'),
  });

  registry.register({
    name: 'thumbsdown',
    description: 'Record negative feedback: /thumbsdown [reason]',
    handler: feedbackHandler('down'),
  });

  // ---------------- v2.2.1: read-shaped additions ----------------

  registry.register({
    name: 'audit',
    description: 'Recent token usage: /audit [--last <n>]',
    handler: async (ctx) => {
      const nIdx = ctx.argsList.indexOf('--last');
      const n = Math.min(200, Math.max(1, parseInt(nIdx >= 0 ? ctx.argsList[nIdx + 1] ?? '20' : '20', 10) || 20));
      try {
        const rows = (await readTokenUsageAudit(workspace.storage)).slice(-n);
        if (!rows.length) return { swallow: true, reply: 'No usage recorded yet.' };
        const stats = aggregateTokenUsage(rows);
        return {
          swallow: true,
          reply: [
            `Recent ${rows.length} events:`,
            `  input tokens:  ${stats.inputTokens.toLocaleString()}`,
            `  output tokens: ${stats.outputTokens.toLocaleString()}`,
            `  cost (USD):    $${stats.estimatedCostUsd.toFixed(4)}`,
            '',
            'Top agents:',
            ...Object.entries(stats.byAgent)
              .slice(0, 5)
              .map(
                ([id, t]) =>
                  `  ${id} — ${t.totalTokens.toLocaleString()} tokens · $${t.estimatedCostUsd.toFixed(4)}`,
              ),
          ].join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Audit read failed: ${errMsg(error)}` };
      }
    },
  });

  if (opts.memory) {
    const memory = opts.memory;
    registry.register({
      name: 'memory',
      description: 'Search this workspace\'s memory: /memory <query>',
      handler: async (ctx) => {
        const query = ctx.argsRaw.trim();
        if (!query) return { swallow: true, reply: 'Usage: /memory <query>' };
        if (!memory.search) return { swallow: true, reply: 'Memory provider does not support search.' };
        try {
          const hits = await memory.search(query, { userId: ctx.userId, limit: 8 });
          if (!hits.length) return { swallow: true, reply: 'No memory hits.' };
          return {
            swallow: true,
            reply: hits
              .map((h) => `  · ${(h.content ?? '').slice(0, 200)}`)
              .join('\n'),
          };
        } catch (error) {
          return { swallow: true, reply: `Memory search failed: ${errMsg(error)}` };
        }
      },
    });
  }

  registry.register({
    name: 'knowledge',
    description: 'List knowledge bases, or entries in one: /knowledge [<slug>]',
    handler: async (ctx) => {
      const kb = new KnowledgeBaseStore(workspace.rootDir ?? '.');
      const slug = ctx.argsList[0];
      try {
        if (!slug) {
          const bases: string[] = await kb.listBases();
          return {
            swallow: true,
            reply: bases.length ? bases.map((b: string) => `  ${b}`).join('\n') : 'No knowledge bases.',
          };
        }
        const entries: string[] = await kb.listRaw(slug);
        return {
          swallow: true,
          reply: entries.length
            ? [`${slug}:`, ...entries.slice(-20).map((e: string) => `  ${e}`)].join('\n')
            : `No entries under ${slug}.`,
        };
      } catch (error) {
        return { swallow: true, reply: `Knowledge read failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'artifacts',
    description: 'Recent artifacts: /artifacts [--session <id>|--global]',
    handler: async (ctx) => {
      const scopedIdx = ctx.argsList.indexOf('--session');
      const global = ctx.argsList.includes('--global');
      const sessionId = scopedIdx >= 0 ? ctx.argsList[scopedIdx + 1] : global ? undefined : ctx.sessionId;
      try {
        const items = await workspace.artifacts.list(sessionId);
        if (!items.length) return { swallow: true, reply: 'No artifacts.' };
        return {
          swallow: true,
          reply: items
            .slice(-15)
            .map(
              (a) =>
                `  ${a.id.slice(0, 12)} · ${a.kind ?? 'blob'} · ${(a as { sizeBytes?: number }).sizeBytes ?? '?'}b`,
            )
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Artifacts read failed: ${errMsg(error)}` };
      }
    },
  });

  if (opts.harness) {
    const harness = opts.harness;
    registry.register({
      name: 'harness',
      description: 'Harness defaults + effective profile for this thread',
      handler: async (ctx) => {
        const profile = resolveChannelProfile(
          [], // profiles are held internally; the fallback shape matches the loader default
          ctx.channel,
        );
        return {
          swallow: true,
          reply: [
            `harness.enabled: ${harness.enabled}`,
            `soul: ${harness.defaults.soulSlug ?? '-'}`,
            `suppressRawOutput: ${harness.defaults.suppressRawOutput}`,
            `idleMinutes: ${harness.defaults.idleMinutes}`,
            `channel profile (${ctx.channel}): engageOn=${profile.engageOn} dmPolicy=${profile.dmPolicy}`,
          ].join('\n'),
        };
      },
    });

    if (harness.connectBroker) {
      const broker = harness.connectBroker;
      registry.register({
        name: 'connections',
        description: 'List connection-broker entries (payloads never printed)',
        handler: async () => {
          try {
            const items = await broker.listConnections();
            if (!items.length) return { swallow: true, reply: 'No connections.' };
            return {
              swallow: true,
              reply: items
                .slice(-15)
                .map((c) => `  ${c.channel}:${c.userId} · ${c.service} · expires ${c.expiresAt}`)
                .join('\n'),
            };
          } catch (error) {
            return { swallow: true, reply: `Connections read failed: ${errMsg(error)}` };
          }
        },
      });
    }
  }

  registry.register({
    name: 'worktree',
    description: 'List git worktrees created for isolated sessions',
    handler: async () => {
      const wt = workspace.worktrees;
      if (!wt) return { swallow: true, reply: 'Worktrees not configured.' };
      try {
        const items = await wt.list();
        if (!items.length) return { swallow: true, reply: 'No worktrees.' };
        return {
          swallow: true,
          reply: items
            .map((w) => `  ${w.sessionId.slice(0, 12)} · ${w.branch ?? '-'} · ${w.path}`)
            .join('\n'),
        };
      } catch (error) {
        return { swallow: true, reply: `Worktree read failed: ${errMsg(error)}` };
      }
    },
  });
}

async function patchSessionMeta(
  workspace: Workspace,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const s = await workspace.sessions.get(sessionId);
  if (!s) return;
  await workspace.sessions.update(sessionId, {
    metadata: { ...(s.metadata ?? {}), ...patch },
  });
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
