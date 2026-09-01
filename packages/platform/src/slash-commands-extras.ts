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
  BatchEngine,
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
import {
  editPrimitive,
  removePrimitive,
  resolvePrimitivePath,
  scaffoldPrimitive,
  type TrashablePrimitive,
  type Workspace,
} from '@anvio/workspace';
import { PendingMutationStore, type PendingMutationAction } from './pending-mutations.js';
import { createBatchEngine } from '@anvio/batch';
import { FilesystemStorageProvider } from '@anvio/storage';
import type { BlueprintExecutor } from '@anvio/blueprints';
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
  /** Executor used by /batch enqueue and by ProviderRouter probes. */
  blueprintExecutor?: BlueprintExecutor;
  /** Optional model-router probe for /providers test. */
  probeModelRoute?: (route: string, prompt: string) => Promise<{ selectedProvider?: string; content?: string; latencyMs?: number }>;
}

const TRASHABLE_PRIMITIVES: readonly TrashablePrimitive[] = [
  'agent',
  'persona',
  'soul',
  'skill',
  'workflow',
  'goal',
  'blueprint',
  'automation',
  'hook',
  'mcp',
  'knowledge',
] as const;

function isTrashablePrimitive(value: string | undefined): value is TrashablePrimitive {
  return !!value && (TRASHABLE_PRIMITIVES as readonly string[]).includes(value);
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
    description: 'Show last N turns: /history [n] [--branch]',
    handler: async (ctx) => {
      const s = await workspace.sessions.get(ctx.sessionId);
      if (!s) return { swallow: true, reply: 'No session.' };

      if (ctx.argsList.includes('--branch')) {
        // Walk ancestors up, then collect descendants down.
        const all = await workspace.sessions.list();
        const byId = new Map(all.map((row) => [row.id, row]));
        const rootId = (() => {
          let cur = s;
          const seen = new Set<string>();
          while (cur.parentSessionId && !seen.has(cur.id)) {
            seen.add(cur.id);
            const parent = byId.get(cur.parentSessionId);
            if (!parent) break;
            cur = parent;
          }
          return cur.id;
        })();
        const children = new Map<string, string[]>();
        for (const row of all) {
          if (!row.parentSessionId) continue;
          const arr = children.get(row.parentSessionId) ?? [];
          arr.push(row.id);
          children.set(row.parentSessionId, arr);
        }
        const lines: string[] = [];
        const walk = (id: string, depth: number): void => {
          const row = byId.get(id);
          if (!row) return;
          const marker = id === ctx.sessionId ? '● ' : '  ';
          const label = (row.metadata as { branchLabel?: string } | undefined)?.branchLabel;
          lines.push(
            `${' '.repeat(depth * 2)}${marker}${row.id.slice(0, 12)}` +
              ` · ${row.status}${label ? ` · ${label}` : ''}` +
              ` · ${row.messages.length} msgs`,
          );
          for (const childId of children.get(id) ?? []) walk(childId, depth + 1);
        };
        walk(rootId, 0);
        return { swallow: true, reply: lines.join('\n') };
      }

      const nRaw = ctx.argsList.find((a) => !a.startsWith('--')) ?? '10';
      const n = Math.min(50, Math.max(1, parseInt(nRaw, 10) || 10));
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

  // ---------------- Session forking (ADR-0025) ----------------

  registry.register({
    name: 'branch',
    description: 'Fork this session into a labeled child: /branch <label>',
    handler: async (ctx) => {
      const label = ctx.argsList.join(' ').trim();
      if (!label) return { swallow: true, reply: 'Usage: /branch <label>' };
      const parent = await workspace.sessions.get(ctx.sessionId);
      if (!parent) return { swallow: true, reply: 'No session to branch from.' };

      const checkpoint = (parent.metadata as { agentRunCheckpoint?: { messages?: number } } | undefined)
        ?.agentRunCheckpoint;
      const cutoff =
        typeof checkpoint?.messages === 'number'
          ? Math.min(checkpoint.messages, parent.messages.length)
          : parent.messages.length;

      const { agentRunCheckpoint: _drop, ...restMeta } = (parent.metadata ?? {}) as Record<string, unknown>;
      const child = await workspace.sessions.create({
        userId: parent.userId,
        agentName: parent.agentName,
        channel: parent.channel,
        channelThread: parent.channelThread,
        parentSessionId: parent.id,
        messages: parent.messages.slice(0, cutoff),
        status: 'idle',
        detached: parent.detached,
        metadata: { ...restMeta, branchLabel: label, branchedFromMessages: cutoff },
      });

      return {
        swallow: true,
        reply: [
          `Branched → ${child.id}`,
          `label: ${label}`,
          `seeded ${cutoff}/${parent.messages.length} messages from parent ${parent.id.slice(0, 12)}`,
          `next message runs on the branch.`,
        ].join('\n'),
      };
    },
  });

  registry.register({
    name: 'resume',
    description: 'Reopen the last failed/idle session in this thread and re-run',
    handler: async (ctx) => {
      const all = await workspace.sessions.list();
      const candidates = all
        .filter(
          (s) =>
            s.id !== ctx.sessionId &&
            s.channelThread?.channel === ctx.channel &&
            s.channelThread?.threadId === ctx.threadId &&
            s.status === 'failed',
        )
        .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
      const target = candidates[0];
      if (!target) return { swallow: true, reply: 'Nothing to resume in this thread.' };

      const checkpoint = (target.metadata as { agentRunCheckpoint?: { messages?: number } } | undefined)
        ?.agentRunCheckpoint;
      let messages = target.messages;
      if (typeof checkpoint?.messages === 'number' && checkpoint.messages < messages.length) {
        messages = messages.slice(0, checkpoint.messages);
        await workspace.sessions.update(target.id, { messages });
      }

      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
        sessionId: target.id,
        userId: target.userId,
        agentId: target.agentName,
        content: lastUser?.content ?? '',
        channel: target.channel,
        detached: target.detached ?? false,
      });

      return {
        swallow: true,
        reply: [
          `Resuming ${target.id.slice(0, 12)} (was ${target.status}).`,
          checkpoint?.messages !== undefined
            ? `Rewound to checkpoint at message ${checkpoint.messages}.`
            : 'No checkpoint — re-running the last user turn.',
        ].join('\n'),
      };
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
        description: 'List broker entries: /connections [list|revoke <channel> <userId> <service>]',
        handler: async (ctx) => {
          const sub = (ctx.argsList[0] ?? 'list').toLowerCase();
          try {
            if (sub === 'list') {
              const items = await broker.listConnections();
              if (!items.length) return { swallow: true, reply: 'No connections.' };
              return {
                swallow: true,
                reply: items
                  .slice(-15)
                  .map((c) => `  ${c.channel}:${c.userId} · ${c.service} · expires ${c.expiresAt}`)
                  .join('\n'),
              };
            }
            if (sub === 'revoke') {
              const channel = ctx.argsList[1];
              const userId = ctx.argsList[2];
              const service = ctx.argsList[3];
              if (!channel || !userId || !service) {
                return {
                  swallow: true,
                  reply: 'Usage: /connections revoke <channel> <userId> <service>',
                };
              }
              const removed = await broker.revokeConnection(channel, userId, service);
              return {
                swallow: true,
                reply: removed
                  ? `Revoked ${channel}:${userId}/${service}.`
                  : `No matching connection to revoke.`,
              };
            }
            return {
              swallow: true,
              reply: 'Usage: /connections [list|revoke <channel> <userId> <service>]',
            };
          } catch (error) {
            return { swallow: true, reply: `Connections op failed: ${errMsg(error)}` };
          }
        },
      });
    }
  }

  registry.register({
    name: 'worktree',
    description: 'Git worktrees: /worktree [list|new <sessionId>|rm <sessionId>]',
    handler: async (ctx) => {
      const wt = workspace.worktrees;
      if (!wt) return { swallow: true, reply: 'Worktrees not configured.' };
      const sub = (ctx.argsList[0] ?? 'list').toLowerCase();
      try {
        if (sub === 'list') {
          const items = await wt.list();
          if (!items.length) return { swallow: true, reply: 'No worktrees.' };
          return {
            swallow: true,
            reply: items
              .map((w) => `  ${w.sessionId.slice(0, 12)} · ${w.branch ?? '-'} · ${w.path}`)
              .join('\n'),
          };
        }
        if (sub === 'new' || sub === 'create') {
          const sessionId = ctx.argsList[1];
          if (!sessionId) return { swallow: true, reply: 'Usage: /worktree new <sessionId>' };
          const created = await wt.create(sessionId);
          return {
            swallow: true,
            reply: `Worktree created: ${created.path}${created.branch ? ` (branch ${created.branch})` : ''}`,
          };
        }
        if (sub === 'rm' || sub === 'remove') {
          const sessionId = ctx.argsList[1];
          if (!sessionId) return { swallow: true, reply: 'Usage: /worktree rm <sessionId>' };
          await wt.remove(sessionId);
          return { swallow: true, reply: `Worktree removed for session ${sessionId.slice(0, 12)}.` };
        }
        return { swallow: true, reply: 'Usage: /worktree [list|new <sessionId>|rm <sessionId>]' };
      } catch (error) {
        return { swallow: true, reply: `Worktree op failed: ${errMsg(error)}` };
      }
    },
  });

  // ---------------- Mutation surface (ADR-0025 track 2) ----------------
  //
  // Two-turn safety: `/new <primitive> <slug>`, `/edit <primitive> <slug>
  // ```body```` or `/rm <primitive> <slug>` post a preview and stash the
  // pending mutation under a confirm token. `/confirm <token>` applies it,
  // `/cancel <token>` drops it. Formal harness-approver wiring is deferred
  // to track 3 (the audit record already carries `approvalId` so the
  // upgrade is drop-in).

  const pendingMutations = new PendingMutationStore();

  const stagePending = async (
    ctx: {
      channel: string;
      sessionId: string;
      userId: string;
    },
    action: PendingMutationAction,
    primitive: TrashablePrimitive,
    slug: string,
    body?: string,
    reason?: string,
  ): Promise<{ token: string; preview: string }> => {
    const entry = pendingMutations.put({
      action,
      primitive,
      slug,
      body,
      actor: ctx.userId,
      channel: ctx.channel,
      sessionId: ctx.sessionId,
      reason,
    });
    let preview: string;
    if (action === 'rm') {
      preview = `Will move ${primitive}/${slug} to workspace/_trash/. Restore with: anvio trash restore ${primitive} <entryName>`;
    } else if (action === 'new') {
      preview = body
        ? `Will create ${primitive}/${slug} with the provided body (${Buffer.byteLength(body, 'utf-8')} bytes).`
        : `Will create ${primitive}/${slug} from the built-in template.`;
    } else {
      preview = `Will overwrite ${primitive}/${slug} (${Buffer.byteLength(body ?? '', 'utf-8')} bytes). Prior version trashed.`;
    }
    return {
      token: entry.token,
      preview: [
        preview,
        '',
        `Confirm: /confirm ${entry.token}   ·   Cancel: /cancel ${entry.token}`,
        '(expires in 5 minutes)',
      ].join('\n'),
    };
  };

  registry.register({
    name: 'new',
    description: 'Scaffold a workspace primitive: /new <primitive> <slug>',
    handler: async (ctx) => {
      const primitive = ctx.argsList[0];
      const slug = ctx.argsList[1];
      if (!isTrashablePrimitive(primitive) || !slug) {
        return {
          swallow: true,
          reply: `Usage: /new <primitive> <slug>\nPrimitives: ${TRASHABLE_PRIMITIVES.join(', ')}`,
        };
      }
      const existing = await resolvePrimitivePath(workspace.rootDir, primitive, slug);
      if (existing) {
        return {
          swallow: true,
          reply: `${primitive}/${slug} already exists at ${existing.path}. Use /edit to change it or /rm to remove.`,
        };
      }
      const staged = await stagePending(ctx, 'new', primitive, slug);
      return { swallow: true, reply: staged.preview };
    },
  });

  registry.register({
    name: 'rm',
    description: 'Soft-delete a primitive: /rm <primitive> <slug> [reason...]',
    handler: async (ctx) => {
      const primitive = ctx.argsList[0];
      const slug = ctx.argsList[1];
      const reason = ctx.argsList.slice(2).join(' ').trim() || undefined;
      if (!isTrashablePrimitive(primitive) || !slug) {
        return {
          swallow: true,
          reply: `Usage: /rm <primitive> <slug> [reason]\nPrimitives: ${TRASHABLE_PRIMITIVES.join(', ')}`,
        };
      }
      const existing = await resolvePrimitivePath(workspace.rootDir, primitive, slug);
      if (!existing) {
        return { swallow: true, reply: `Not found: ${primitive}/${slug}` };
      }
      const staged = await stagePending(ctx, 'rm', primitive, slug, undefined, reason);
      return { swallow: true, reply: staged.preview };
    },
  });

  registry.register({
    name: 'edit',
    description: 'Replace a primitive: /edit <primitive> <slug> ```<body>```',
    handler: async (ctx) => {
      const primitive = ctx.argsList[0];
      const slug = ctx.argsList[1];
      if (!isTrashablePrimitive(primitive) || !slug) {
        return {
          swallow: true,
          reply:
            'Usage: /edit <primitive> <slug> ```<body>```\n' +
            'Primitives: ' + TRASHABLE_PRIMITIVES.join(', '),
        };
      }
      const existing = await resolvePrimitivePath(workspace.rootDir, primitive, slug);
      if (!existing) {
        return {
          swallow: true,
          reply: `Not found: ${primitive}/${slug}. Use /new ${primitive} ${slug} to create it.`,
        };
      }
      // Extract fenced body from the raw arg string. Accept ``` or ~~~ fences.
      const body = extractFencedBody(ctx.argsRaw);
      if (!body) {
        return {
          swallow: true,
          reply:
            'Include the new body in a fenced code block:\n' +
            `/edit ${primitive} ${slug} \`\`\`\n<file contents>\n\`\`\``,
        };
      }
      const staged = await stagePending(ctx, 'edit', primitive, slug, body);
      return { swallow: true, reply: staged.preview };
    },
  });

  registry.register({
    name: 'confirm',
    description: 'Apply a pending /new /edit /rm: /confirm <token>',
    handler: async (ctx) => {
      const token = ctx.argsList[0];
      if (!token) return { swallow: true, reply: 'Usage: /confirm <token>' };
      const entry = pendingMutations.take(token);
      if (!entry) return { swallow: true, reply: 'Token unknown or expired.' };
      if (entry.sessionId !== ctx.sessionId) {
        return { swallow: true, reply: 'Token belongs to a different session.' };
      }
      try {
        if (entry.action === 'new') {
          const result = await scaffoldPrimitive(workspace.rootDir, entry.primitive, entry.slug, {
            actor: entry.actor,
            channel: entry.channel,
            sessionId: entry.sessionId,
            approvalId: entry.token,
            body: entry.body,
          });
          return {
            swallow: true,
            reply: `Created ${entry.primitive}/${entry.slug} → ${result.path} (${result.bytesWritten} bytes)`,
          };
        }
        if (entry.action === 'rm') {
          const result = await removePrimitive(workspace.rootDir, entry.primitive, entry.slug, {
            actor: entry.actor,
            channel: entry.channel,
            sessionId: entry.sessionId,
            approvalId: entry.token,
            reason: entry.reason,
          });
          return {
            swallow: true,
            reply: `Trashed ${entry.primitive}/${entry.slug}. Restore with: ${result.trash.restoreCommand}`,
          };
        }
        const result = await editPrimitive(workspace.rootDir, entry.primitive, entry.slug, {
          actor: entry.actor,
          channel: entry.channel,
          sessionId: entry.sessionId,
          approvalId: entry.token,
          body: entry.body ?? '',
        });
        return {
          swallow: true,
          reply: `Edited ${entry.primitive}/${entry.slug} (${result.hashBefore} → ${result.hashAfter}, ${result.bytesWritten} bytes). Prior version trashed.`,
        };
      } catch (error) {
        return { swallow: true, reply: `Mutation failed: ${errMsg(error)}` };
      }
    },
  });

  registry.register({
    name: 'cancel',
    description: 'Discard a pending mutation: /cancel <token>',
    handler: async (ctx) => {
      const token = ctx.argsList[0];
      if (!token) return { swallow: true, reply: 'Usage: /cancel <token>' };
      const dropped = pendingMutations.cancel(token);
      return {
        swallow: true,
        reply: dropped ? 'Cancelled.' : 'Token unknown or already resolved.',
      };
    },
  });

  registry.register({
    name: 'pending',
    description: 'List pending mutations in this session',
    handler: async (ctx) => {
      const items = pendingMutations.listForSession(ctx.sessionId);
      if (!items.length) return { swallow: true, reply: 'No pending mutations.' };
      return {
        swallow: true,
        reply: items
          .map(
            (e) =>
              `  ${e.token} · ${e.action} ${e.primitive}/${e.slug} · expires ${new Date(e.expiresAt).toISOString()}`,
          )
          .join('\n'),
      };
    },
  });

  // ---------------- Batch (ADR-0025 track 2) ----------------

  const batchEngine: BatchEngine | undefined = opts.blueprintExecutor
    ? createBatchEngine({
        storage: new FilesystemStorageProvider(workspace.rootDir),
        workspaceRoot: workspace.rootDir,
        blueprintRunner: {
          run: async (blueprint, inputs, runOpts) =>
            opts.blueprintExecutor!.run(blueprint, inputs, runOpts),
        },
      })
    : undefined;

  if (batchEngine) {
    registry.register({
      name: 'batch',
      description: 'Batch jobs: /batch [list|status <id>|stop <id>|enqueue <blueprint>]',
      handler: async (ctx) => {
        const sub = (ctx.argsList[0] ?? 'list').toLowerCase();
        try {
          if (sub === 'list') {
            const stateDir = path.join(workspace.rootDir, 'batch');
            let dirs: string[];
            try {
              dirs = await fs.readdir(stateDir);
            } catch {
              return { swallow: true, reply: 'No batch jobs.' };
            }
            const jobs = dirs.filter((d) => d && !d.startsWith('_') && !d.startsWith('.'));
            if (!jobs.length) return { swallow: true, reply: 'No batch jobs.' };
            const lines: string[] = [];
            for (const jobId of jobs.slice(-15)) {
              const status = await batchEngine.getStatus(jobId).catch(() => null);
              const progress = await batchEngine.getProgress(jobId).catch(() => null);
              lines.push(
                `  ${jobId} · ${status?.status ?? '?'} · ${progress?.completed ?? 0}/${progress?.total ?? 0} completed`,
              );
            }
            return { swallow: true, reply: lines.join('\n') };
          }
          if (sub === 'status') {
            const jobId = ctx.argsList[1];
            if (!jobId) return { swallow: true, reply: 'Usage: /batch status <jobId>' };
            const status = await batchEngine.getStatus(jobId);
            const progress = await batchEngine.getProgress(jobId);
            if (!status) return { swallow: true, reply: `Batch job not found: ${jobId}` };
            return {
              swallow: true,
              reply: [
                `job ${jobId}`,
                `status: ${status.status} · started ${status.startedAt ?? '-'} · completed ${status.completedAt ?? '-'}`,
                progress
                  ? `progress: ${progress.completed}/${progress.total} (failed ${progress.failed}, in-progress ${progress.inProgress})`
                  : 'progress: (none)',
              ].join('\n'),
            };
          }
          if (sub === 'stop' || sub === 'cancel') {
            const jobId = ctx.argsList[1];
            if (!jobId) return { swallow: true, reply: 'Usage: /batch stop <jobId>' };
            await batchEngine.cancel(jobId);
            return { swallow: true, reply: `Batch cancelled: ${jobId}` };
          }
          if (sub === 'enqueue' || sub === 'run') {
            const blueprint = ctx.argsList[1];
            if (!blueprint) return { swallow: true, reply: 'Usage: /batch enqueue <blueprint>' };
            // Fire-and-forget — the batch engine writes progress to disk;
            // the operator can poll with `/batch status <id>` once the reply
            // returns the new job id.
            const runResult = batchEngine.run(
              {
                name: `chat-enqueue-${blueprint}`,
                blueprint,
                input: { type: 'inline', items: [{ userId: ctx.userId }] },
                concurrency: 1,
                retry: { maxAttempts: 1, backoff: 'exponential', delayMs: 1000, retryOn: [] },
                dryRun: false,
              },
              undefined,
              {},
            );
            // Race the first tick so we can hand the jobId back.
            const first = await Promise.race([
              runResult.then((r) => ({ jobId: r.jobId, ready: true })),
              new Promise<{ jobId: string; ready: boolean }>((resolve) =>
                setTimeout(() => resolve({ jobId: '(running)', ready: false }), 250),
              ),
            ]);
            return {
              swallow: true,
              reply:
                first.ready
                  ? `Batch enqueued and completed synchronously: ${first.jobId}. Poll: /batch status ${first.jobId}`
                  : `Batch running in background — see /batch list to discover the new job id.`,
            };
          }
          return { swallow: true, reply: 'Usage: /batch [list|status <id>|stop <id>|enqueue <blueprint>]' };
        } catch (error) {
          return { swallow: true, reply: `Batch op failed: ${errMsg(error)}` };
        }
      },
    });
  }

  // ---------------- Setup-token pointer ----------------
  //
  // ADR-0025 called for a full chat-native OAuth flow with QR fallback. The
  // vendor CLIs (`claude`, `cursor`, `codex`, `antigravity`) spawn a
  // browser-authorized subprocess on the operator's machine — that cannot
  // run inside a bot process, so the chat command posts the equivalent CLI
  // invocation and the callback URL prefix instead. The URL polling +
  // QR-as-attachment path is queued for track 3.

  registry.register({
    name: 'setup-token',
    description: 'How to complete a runtime OAuth login: /setup-token <claude|cursor|codex|antigravity|nous>',
    handler: async (ctx) => {
      const vendor = (ctx.argsList[0] ?? '').toLowerCase();
      const known = ['claude', 'cursor', 'codex', 'antigravity', 'nous'];
      if (!known.includes(vendor)) {
        return {
          swallow: true,
          reply: `Usage: /setup-token <${known.join('|')}>`,
        };
      }
      return {
        swallow: true,
        reply: [
          `Runtime OAuth for ${vendor} must run on the operator's machine (the vendor CLI opens a browser).`,
          '',
          `Run this locally, then re-check /connections:`,
          `  anvio setup-token --${vendor}`,
          '',
          'Track 3 will bridge this into chat via a callback URL + QR attachment (ADR-0025 §Setup-token).',
        ].join('\n'),
      };
    },
  });

  // ---------------- /providers test <route> [prompt...] ----------------

  if (opts.probeModelRoute) {
    const probe = opts.probeModelRoute;
    registry.register({
      name: 'providers-test',
      description: 'Probe a routing entry: /providers-test <route> [prompt]',
      handler: async (ctx) => {
        const route = ctx.argsList[0];
        if (!route) {
          return {
            swallow: true,
            reply: 'Usage: /providers-test <route> [prompt]\nSee /workflows and providers/routing.yaml for routes.',
          };
        }
        const prompt = ctx.argsList.slice(1).join(' ') || 'ping';
        const started = Date.now();
        try {
          const result = await probe(route, prompt);
          const ms = Date.now() - started;
          return {
            swallow: true,
            reply: [
              `route ${route} → ${result.selectedProvider ?? '?'}`,
              `latency ~${ms}ms`,
              result.content ? `sample: ${result.content.slice(0, 200)}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          };
        } catch (error) {
          return { swallow: true, reply: `Probe failed: ${errMsg(error)}` };
        }
      },
    });
  }
}

/**
 * Extract the innermost fenced block from a raw arg string. Accepts ``` and
 * ~~~ fences with an optional language tag. Returns null when no fence is
 * present — the caller then asks the user to wrap the body in fences.
 */
function extractFencedBody(raw: string): string | null {
  const fenceRe = /(?:```|~~~)[a-zA-Z0-9_+-]*\n([\s\S]*?)\n(?:```|~~~)/;
  const match = raw.match(fenceRe);
  return match ? match[1] : null;
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
