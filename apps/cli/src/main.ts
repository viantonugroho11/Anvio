#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { parse as parseYaml } from 'yaml';
import { EventSubjects } from '@anvio/events';
import { CliChannel, probeAllChannels, summarizeChannelHealth } from '@anvio/channels';
import type { ChannelHealthReport, GoalStatus, SoulDefinition, StoredSession } from '@anvio/core';
import { parseSkillDefinition } from '@anvio/core';
import { nextCronRuns } from '@anvio/automation';
import { BlueprintExecutor, createCatalogRegistry } from '@anvio/blueprints';
import { createBatchEngine } from '@anvio/batch';
import { createCredentialPoolManager } from '@anvio/credentials';
import { createIntegrationRegistry, createMcpBridge } from '@anvio/integrations';
import { createModelRouter, MODEL_PROVIDER_IDS, OPENAI_COMPATIBLE_PROVIDER_SPECS } from '@anvio/models';
import { createSkillCatalogResolver, createSkillInstaller } from '@anvio/skills';
import { createAcpServer } from '@anvio/acp';
import { createCodeExecutor, ExecutionAuditLog } from '@anvio/execution';
import { createRuntimeFactory } from '@anvio/runtimes';
import { createGoalEngine } from '@anvio/goals';
import { createKanbanEngine } from '@anvio/kanban';
import { createMemoryProvider } from '@anvio/memory';
import { createPlatform, findRepoRoot, loadAgent, storedSessionToRuntime } from '@anvio/platform';
import { createSoulService } from '@anvio/souls';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace, WORKSPACE_DIRS } from '@anvio/workspace';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

async function main() {
  switch (command) {
    case 'init':
      await cmdInit(args[1]);
      break;
    case 'agents':
      await cmdAgents(args.slice(1));
      break;
    case 'chat':
      await cmdChat(args.slice(1));
      break;
    case 'run':
      await cmdRun(args.slice(1));
      break;
    case 'sessions':
      await cmdSessions(args.slice(1));
      break;
    case 'status':
      await cmdStatus(args.slice(1));
      break;
    case 'logs':
      await cmdLogs(args.slice(1));
      break;
    case 'approve':
      await cmdApprove(args.slice(1));
      break;
    case 'stop':
      await cmdStop(args.slice(1));
      break;
    case 'inbox':
      await cmdInbox(args.slice(1));
      break;
    case 'worktree':
      await cmdWorktree(args.slice(1));
      break;
    case 'channels':
      await cmdChannels(args.slice(1));
      break;
    case 'soul':
      await cmdSoul(args.slice(1));
      break;
    case 'goal':
      await cmdGoal(args.slice(1));
      break;
    case 'blueprint':
      await cmdBlueprint(args.slice(1));
      break;
    case 'automation':
      await cmdAutomation(args.slice(1));
      break;
    case 'cron':
      await cmdCron(args.slice(1));
      break;
    case 'hooks':
      await cmdHooks(args.slice(1));
      break;
    case 'kanban':
      await cmdKanban(args.slice(1));
      break;
    case 'batch':
      await cmdBatch(args.slice(1));
      break;
    case 'runtime':
      await cmdRuntime(args.slice(1));
      break;
    case 'execution':
    case 'exec':
      await cmdExecution(args.slice(1));
      break;
    case 'acp':
      await cmdAcp(args.slice(1));
      break;
    case 'credentials':
      await cmdCredentials(args.slice(1));
      break;
    case 'routing':
      await cmdRouting(args.slice(1));
      break;
    case 'skill':
      await cmdSkill(args.slice(1));
      break;
    case 'mcp':
      await cmdMcp(args.slice(1));
      break;
    case 'workspace':
      await cmdWorkspace(args.slice(1));
      break;
    case 'help':
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`Anvio — Local-First AI Agent Operating System

Core
  anvio init [path]                    Initialize workspace scaffold
  anvio agents list                    List configured agents
  anvio chat [--agent NAME]            Interactive chat session
  anvio run <agent> [message]          Run task (--detach for background)
  anvio sessions list                  List agent sessions
  anvio status [sessionId]             Platform or session status
  anvio logs <sessionId>               Session message log
  anvio approve <session> <id>         Approve pending tool request
  anvio stop <sessionId>               Stop running session
  anvio inbox <sessionId> <msg>        Inject instruction into running agent
  anvio worktree list|create|remove    Git worktree isolation
  anvio channels status [--json]       Channel adapter health check

Advanced Agent OS — Identity & Goals
  anvio soul list|show|create          Persistent agent souls
  anvio goal list|create|progress      Goal tracking
  anvio goal complete|pause|resume     Goal lifecycle

Automation & Workflows
  anvio blueprint catalog|run          Workflow blueprint catalog
  anvio automation list|run|enable     Event and scheduled automations
  anvio cron list|next-runs            Cron schedule utilities
  anvio hooks test <event>             Test event hook handlers
  anvio batch run|status|resume        Parallel batch jobs

Coordination
  anvio kanban list|create|move        Kanban board tasks

Execution & Providers
  anvio runtime list|test              Runtime providers (local, cursor, …)
  anvio exec run|audit                 Sandboxed code execution
  anvio acp serve|status               ACP editor integration server
  anvio credentials list|add|test      Encrypted credential pools
  anvio routing show|providers|catalog|test  Provider routing and fallback
  anvio skill catalog|install|validate Skills catalog management
  anvio mcp list|test                  MCP integration servers
  anvio workspace validate             Validate workspace structure

Environment
  ANVIO_WORKSPACE                      Workspace path (default: ./workspace)
  ANTHROPIC_API_KEY                    Anthropic (Claude)
  OPENAI_API_KEY                       OpenAI (GPT)
  GEMINI_API_KEY / GOOGLE_API_KEY      Google Gemini
  OPENROUTER_API_KEY                   OpenRouter (100+ models)
  DEEPSEEK_API_KEY                     DeepSeek (deepseek-chat, deepseek-reasoner)
  GROQ_API_KEY / MISTRAL_API_KEY       Groq, Mistral
  TOGETHER_API_KEY / XAI_API_KEY        Together, xAI Grok
  FIREWORKS_API_KEY / MOONSHOT_API_KEY  Fireworks, Moonshot/Kimi
  CEREBRAS_API_KEY / SAMBANOVA_API_KEY  Cerebras, SambaNova
  PERPLEXITY_API_KEY / COHERE_API_KEY   Perplexity, Cohere
  HF_TOKEN                             Hugging Face Inference
  OLLAMA_BASE_URL / OLLAMA_ENABLED     Local Ollama models
  ANVIO_CREDENTIALS_PASSPHRASE         Credential pool encryption passphrase
  TELEGRAM_BOT_TOKEN / DISCORD_BOT_TOKEN / SLACK_BOT_TOKEN / SLACK_APP_TOKEN
  WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_VERIFY_TOKEN
  GITHUB_TOKEN                         MCP GitHub server (when enabled)

Docs: docs/24-advanced-agent-os-overview.md
Priority: CLI > API > Web UI`);
}

async function cmdInit(targetPath?: string) {
  const root = path.resolve(targetPath ?? './workspace');
  await Workspace.init(root);
  console.log(`Workspace initialized at ${root}`);
  console.log('Edit agents/, personas/, skills/ — then run: anvio run architect');
}

async function cmdAgents(sub: string[]) {
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  if (sub[0] === 'list' || sub.length === 0) {
    const agents = await workspace.loader.listAgents();
    if (agents.length === 0) {
      console.log('No agents found. Add YAML files to workspace/agents/');
      return;
    }
    console.log('Agents:');
    for (const name of agents) {
      const agent = await workspace.loader.loadAgent(name);
      console.log(`  ${name} — ${agent.spec.description}`);
    }
  }
}

async function getPlatform() {
  const wsPath = resolveWorkspacePath();
  return createPlatform({ workspacePath: wsPath });
}

async function cmdRun(sub: string[]) {
  const detach = sub.includes('--detach');
  const filtered = sub.filter((a) => a !== '--detach');
  const agentName = filtered[0];
  const message = filtered.slice(1).join(' ').trim() || 'Start task.';

  if (!agentName) {
    console.error('Usage: anvio run <agent> [message] [--detach]');
    process.exit(1);
  }

  const platform = await getPlatform();
  const { workspace, runtime, auth, eventBus, channelHub } = platform;
  const agent = await loadAgent(workspace, agentName);
  const ctx = auth.getDefaultContext();

  const cliChannel = channelHub.getAdapter('cli') as CliChannel | undefined;
  cliChannel?.setSink({
    onChunk: (_id, delta) => process.stdout.write(delta),
    onProgress: (_id, phase, emoji) => process.stdout.write(`${emoji} ${phase}\n`),
  });

  const stored = await workspace.sessions.create({
    userId: ctx.userId,
    agentName,
    channel: 'cli',
    messages: [],
    status: 'idle',
    detached: detach,
  });

  const session = storedSessionToRuntime(stored);
  console.log(`\n🚀 Running ${agentName} (session: ${stored.id})${detach ? ' [detached]' : ''}\n`);

  if (detach) {
    await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
      sessionId: stored.id,
      userId: ctx.userId,
      agentId: agentName,
      content: message,
      channel: 'cli',
      detached: true,
    });
    console.log('Task queued. Use `anvio status` or `anvio logs` to monitor.');
    return;
  }

  let full = '';
  for await (const chunk of runtime.stream(session, agent, { content: message })) {
    if (chunk.type === 'progress') {
      process.stdout.write(`🔄 ${chunk.phase}\n`);
    }
    if (chunk.type === 'chunk' && chunk.delta) {
      process.stdout.write(chunk.delta);
      full += chunk.delta;
    }
    if (chunk.type === 'error') {
      console.error(`\nError: ${chunk.error}`);
    }
    if (chunk.type === 'done') {
      console.log('\n');
      await workspace.sessions.update(stored.id, {
        messages: [
          ...stored.messages,
          { role: 'user', content: message },
          { role: 'assistant', content: full },
        ],
        status: 'completed',
      });
    }
  }
}

async function cmdSessions(sub: string[]) {
  const platform = await getPlatform();
  const { workspace, auth } = platform;
  const ctx = auth.getDefaultContext();
  const sessions = await workspace.sessions.list(ctx.userId);

  if (sub[0] === 'list' || sub.length === 0) {
    if (sessions.length === 0) {
      console.log('No sessions.');
      return;
    }
    printSessionTable(sessions);
  }
}

function printSessionTable(sessions: StoredSession[]) {
  console.log('ID                                   Agent        Channel    Status');
  console.log('─'.repeat(72));
  for (const s of sessions) {
    console.log(
      `${s.id}  ${s.agentName.padEnd(12)} ${s.channel.padEnd(10)} ${s.status}${s.detached ? ' (detached)' : ''}`,
    );
  }
}

async function cmdStatus(sub: string[]) {
  const platform = await getPlatform();
  const { workspace } = platform;
  const sessionId = sub[0];

  if (!sessionId) {
    const active = await workspace.sessions.listActive();
    console.log(`Active sessions: ${active.length}`);
    if (active.length > 0) printSessionTable(active);
    return;
  }

  const session = await workspace.sessions.get(sessionId);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }
  console.log(JSON.stringify(session, null, 2));
}

async function cmdLogs(sub: string[]) {
  const sessionId = sub[0];
  if (!sessionId) {
    console.error('Usage: anvio logs <sessionId>');
    process.exit(1);
  }
  const platform = await getPlatform();
  const session = await platform.workspace.sessions.get(sessionId);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }
  for (const msg of session.messages) {
    console.log(`[${msg.role}] ${msg.content}\n`);
  }
}

async function cmdApprove(sub: string[]) {
  const reject = sub.includes('--reject');
  const filtered = sub.filter((a) => a !== '--reject');
  const [sessionId, requestId] = filtered;

  if (!sessionId || !requestId) {
    console.error('Usage: anvio approve <sessionId> <requestId> [--reject]');
    process.exit(1);
  }

  const platform = await getPlatform();
  await platform.eventBus.publish(EventSubjects.APPROVAL_DECIDED, 'anvio.approval.decided', {
    sessionId,
    requestId,
    approved: !reject,
  });
  console.log(reject ? 'Rejected.' : 'Approved.');
}

async function cmdStop(sub: string[]) {
  const sessionId = sub[0];
  if (!sessionId) {
    console.error('Usage: anvio stop <sessionId>');
    process.exit(1);
  }
  const platform = await getPlatform();
  await platform.eventBus.publish(
    EventSubjects.AGENT_RUN_STOP_REQUESTED,
    'anvio.agent.run.stop',
    { sessionId, reason: 'User requested stop' },
  );
  console.log(`Stop requested for ${sessionId}`);
}

async function cmdInbox(sub: string[]) {
  const sessionId = sub[0];
  const content = sub.slice(1).join(' ').trim();
  if (!sessionId || !content) {
    console.error('Usage: anvio inbox <sessionId> <instruction>');
    process.exit(1);
  }

  const platform = await getPlatform();
  const type = content.toLowerCase() === 'stop' ? 'stop' : 'instruction';
  const msg = await platform.inbox.inject({ sessionId, type, content });
  await platform.eventBus.publish(EventSubjects.AGENT_INBOX_INJECTED, 'anvio.agent.inbox.injected', {
    sessionId,
    messageId: msg.id,
    type,
    content,
  });
  console.log(`Inbox message injected (${type})`);
}

async function cmdWorktree(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const { workspace } = platform;

  if (!workspace.worktrees) {
    console.error('Worktrees disabled. Enable in workspace/anvio.yaml: spec.worktrees.enabled: true');
    process.exit(1);
  }

  switch (action) {
    case 'list': {
      const items = await workspace.worktrees.list();
      if (items.length === 0) {
        console.log('No active worktrees.');
        return;
      }
      for (const wt of items) {
        console.log(`${wt.sessionId}  ${wt.branch}  ${wt.path}`);
      }
      break;
    }
    case 'create': {
      const sessionId = sub[1];
      if (!sessionId) {
        console.error('Usage: anvio worktree create <sessionId>');
        process.exit(1);
      }
      const wt = await workspace.worktrees.create(sessionId);
      console.log(`Created worktree: ${wt.path} (branch: ${wt.branch})`);
      break;
    }
    case 'remove': {
      const sessionId = sub[1];
      if (!sessionId) {
        console.error('Usage: anvio worktree remove <sessionId>');
        process.exit(1);
      }
      await workspace.worktrees.remove(sessionId);
      console.log(`Removed worktree for ${sessionId}`);
      break;
    }
    default:
      console.error('Usage: anvio worktree list|create|remove');
      process.exit(1);
  }
}

const STATUS_ICON: Record<ChannelHealthReport['status'], string> = {
  healthy: '✅',
  degraded: '⚠️',
  disabled: '⏸',
  misconfigured: '❌',
  unreachable: '🔴',
};

async function cmdChannels(sub: string[]) {
  const action = sub[0] ?? 'status';
  if (action !== 'status') {
    console.error('Usage: anvio channels status [--json]');
    process.exit(1);
  }

  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const reports = await probeAllChannels(workspace.config.spec.channels);
  const summary = summarizeChannelHealth(reports);

  if (sub.includes('--json')) {
    console.log(JSON.stringify({ summary, channels: reports }, null, 2));
    return;
  }

  console.log('\nChannel Health\n');
  console.log('Channel     Status          Latency  Message');
  console.log('─'.repeat(72));

  for (const r of reports) {
    const latency = r.latencyMs != null ? `${r.latencyMs}ms`.padEnd(8) : ''.padEnd(8);
    console.log(
      `${r.channel.padEnd(11)} ${(STATUS_ICON[r.status] + ' ' + r.status).padEnd(15)} ${latency} ${r.message}`,
    );
  }

  console.log('─'.repeat(72));
  console.log(
    `Summary: ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.disabled} disabled, ${summary.misconfigured} misconfigured, ${summary.unreachable} unreachable\n`,
  );
}

async function cmdSoul(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const memory = createMemoryProvider(workspace.config.spec.memory.provider, workspace.storage);
  const souls = createSoulService(workspace.storage, memory);

  switch (action) {
    case 'list': {
      const items = await souls.list();
      if (items.length === 0) {
        console.log('No souls found. Create one: anvio soul create --slug cela --name Cela');
        return;
      }
      console.log('Souls:');
      for (const slug of items) {
        const soul = await souls.get(slug);
        console.log(`  ${slug} — ${soul.spec.name}`);
      }
      break;
    }
    case 'show': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio soul show <slug> [--context]');
        process.exit(1);
      }
      const soul = await souls.get(slug);
      if (sub.includes('--context')) {
        const ctx = await souls.loadContext(slug, workspace.config.spec.defaultUserId);
        console.log(souls.renderSoulContext(ctx));
        return;
      }
      console.log(JSON.stringify(soul, null, 2));
      break;
    }
    case 'create': {
      const slugIdx = sub.indexOf('--slug');
      const nameIdx = sub.indexOf('--name');
      const personaIdx = sub.indexOf('--from-persona');
      const slug = slugIdx >= 0 ? sub[slugIdx + 1] : undefined;
      const name = nameIdx >= 0 ? sub[nameIdx + 1] : slug;
      if (!slug || !name) {
        console.error('Usage: anvio soul create --slug <slug> --name <name> [--from-persona <persona>]');
        process.exit(1);
      }

      let definition: SoulDefinition = {
        apiVersion: 'anvio.io/v1',
        kind: 'Soul',
        metadata: { slug, version: '1.0.0' },
        spec: {
          name,
          identity: {},
          values: [],
          personality: [],
          preferences: {},
          communicationStyle: { tone: 'professional', format: 'clear and concise' },
          longTermGoals: [],
          behavioralTendencies: [],
          relationshipMemory: { provider: 'filesystem', path: 'relationship' },
          evolution: { allowAutoUpdate: true, requireApproval: false },
        },
      };

      if (personaIdx >= 0) {
        const personaSlug = sub[personaIdx + 1];
        const persona = await workspace.loader.loadPersona(personaSlug);
        definition = {
          ...definition,
          spec: {
            ...definition.spec,
            name: persona.name ?? name,
            personality: persona.behavior ?? [],
            communicationStyle: {
              tone: persona.tone,
              format: persona.communicationStyle,
            },
            behavioralTendencies: persona.behavior ?? [],
          },
        };
      }

      const saved = await souls.create(definition);
      console.log(`Soul created: ${saved.metadata.slug}`);
      break;
    }
    default:
      console.error('Usage: anvio soul list|show|create');
      process.exit(1);
  }
}

async function cmdGoal(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const goals = createGoalEngine(workspace.storage);

  switch (action) {
    case 'list': {
      const statusArg = sub.indexOf('--status');
      const status = statusArg >= 0 ? (sub[statusArg + 1] as GoalStatus) : undefined;
      const items = await goals.list(status);
      if (items.length === 0) {
        console.log('No goals found. Create one: anvio goal create --slug my-goal --title "My Goal"');
        return;
      }
      console.log('Goals:');
      for (const goal of items) {
        console.log(
          `  ${goal.metadata.slug} [${goal.spec.status}] ${goal.spec.priority} — ${goal.spec.title} (${goal.spec.progress.percent}%)`,
        );
      }
      break;
    }
    case 'create': {
      const slugIdx = sub.indexOf('--slug');
      const titleIdx = sub.indexOf('--title');
      const slug = slugIdx >= 0 ? sub[slugIdx + 1] : undefined;
      const title = titleIdx >= 0 ? sub[titleIdx + 1] : undefined;
      if (!slug || !title) {
        console.error('Usage: anvio goal create --slug <slug> --title <title>');
        process.exit(1);
      }
      const goal = await goals.create({ slug, spec: { title, description: '' } });
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(EventSubjects.GOAL_CREATED, 'anvio.goal.created', {
          goalSlug: slug,
          title,
        });
      } catch {
        // Event bus optional for offline goal creation
      }
      console.log(`Goal created: ${goal.metadata.slug}`);
      break;
    }
    case 'progress': {
      const slug = sub[1];
      const percentIdx = sub.indexOf('--percent');
      const percent = percentIdx >= 0 ? Number(sub[percentIdx + 1]) : undefined;
      if (!slug || percent == null || Number.isNaN(percent)) {
        console.error('Usage: anvio goal progress <slug> --percent <0-100>');
        process.exit(1);
      }
      const goal = await goals.updateProgress(slug, { percent });
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(
          EventSubjects.GOAL_PROGRESS_UPDATED,
          'anvio.goal.progress.updated',
          { goalSlug: slug, percent: goal.spec.progress.percent },
        );
      } catch {
        // Event bus optional
      }
      console.log(`Goal ${slug} progress: ${goal.spec.progress.percent}%`);
      break;
    }
    case 'complete': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal complete <slug>');
        process.exit(1);
      }
      const goal = await goals.complete(slug);
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(EventSubjects.GOAL_COMPLETED, 'anvio.goal.completed', {
          goalSlug: slug,
        });
      } catch {
        // Event bus optional
      }
      console.log(`Goal completed: ${goal.metadata.slug}`);
      break;
    }
    case 'pause': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal pause <slug>');
        process.exit(1);
      }
      await goals.pause(slug);
      console.log(`Goal paused: ${slug}`);
      break;
    }
    case 'resume': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal resume <slug>');
        process.exit(1);
      }
      await goals.resume(slug);
      console.log(`Goal resumed: ${slug}`);
      break;
    }
    default:
      console.error('Usage: anvio goal list|create|progress|complete|pause|resume');
      process.exit(1);
  }
}

async function cmdBlueprint(sub: string[]) {
  const action = sub[0] ?? 'catalog';
  const wsPath = resolveWorkspacePath();
  const catalog = createCatalogRegistry(wsPath, findRepoRoot(wsPath));

  switch (action) {
    case 'catalog': {
      const items = await catalog.listAll();
      if (items.length === 0) {
        console.log('No blueprints found.');
        return;
      }
      for (const item of items) {
        const bp = await catalog.load(item.slug);
        console.log(`  ${item.slug} [${item.source}] — ${bp.spec.description}`);
      }
      break;
    }
    case 'install': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio blueprint install <slug>');
        process.exit(1);
      }
      await catalog.install(slug);
      console.log(`Installed blueprint: ${slug}`);
      break;
    }
    case 'validate': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio blueprint validate <file.yaml>');
        process.exit(1);
      }
      const bp = await catalog.validateFile(path.resolve(file));
      console.log(`Valid: ${bp.metadata.slug}`);
      break;
    }
    case 'run': {
      const slug = sub[1];
      const dryRun = sub.includes('--dry-run');
      if (!slug) {
        console.error('Usage: anvio blueprint run <slug> [--dry-run] [key=value ...]');
        process.exit(1);
      }
      const inputs: Record<string, unknown> = {};
      for (const arg of sub.slice(2)) {
        if (arg.startsWith('--')) continue;
        const [k, v] = arg.split('=');
        if (k && v) inputs[k] = v;
      }
      const executor = new BlueprintExecutor({ catalog });
      const result = await executor.run(slug, inputs, { dryRun });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio blueprint catalog|install|run|validate');
      process.exit(1);
  }
}

async function cmdAutomation(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();

  switch (action) {
    case 'list': {
      const items = await platform.automationEngine.list();
      if (items.length === 0) {
        console.log('No automations in workspace/automations/');
        return;
      }
      for (const a of items) {
        console.log(
          `  ${a.metadata.slug} [${a.metadata.enabled ? 'enabled' : 'disabled'}] — ${a.spec.description}`,
        );
      }
      break;
    }
    case 'run': {
      const slug = sub[1];
      const force = sub.includes('--force');
      if (!slug) {
        console.error('Usage: anvio automation run <slug> [--force]');
        process.exit(1);
      }
      await platform.automationEngine.run(slug, force);
      console.log(`Automation executed: ${slug}`);
      break;
    }
    default:
      console.error('Usage: anvio automation list|run');
      process.exit(1);
  }
}

async function cmdCron(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const scheduler = platform.automationEngine.getCronScheduler();

  switch (action) {
    case 'list': {
      const items = scheduler.listCronAutomations();
      if (items.length === 0) {
        console.log('No cron automations configured.');
        return;
      }
      for (const a of items) {
        const trigger = a.spec.trigger;
        if (trigger.type !== 'cron') continue;
        console.log(`  ${a.metadata.slug} — ${trigger.schedule} (${trigger.timezone})`);
      }
      break;
    }
    case 'next-runs': {
      const limitIdx = sub.indexOf('--limit');
      const limit = limitIdx >= 0 ? Number(sub[limitIdx + 1]) : 5;
      const items = scheduler.listCronAutomations();
      for (const a of items) {
        const trigger = a.spec.trigger;
        if (trigger.type !== 'cron') continue;
        const runs = nextCronRuns(trigger.schedule, new Date(), limit);
        console.log(`${a.metadata.slug}:`);
        for (const run of runs) console.log(`  ${run.toISOString()}`);
      }
      break;
    }
    default:
      console.error('Usage: anvio cron list|next-runs [--limit N]');
      process.exit(1);
  }
}

async function cmdHooks(sub: string[]) {
  const action = sub[0] ?? 'test';
  const wsPath = resolveWorkspacePath();
  const platform = await getPlatform();

  if (action === 'test') {
    const event = sub[1] as import('@anvio/core').HookEventName | undefined;
    if (!event) {
      console.error('Usage: anvio hooks test <onSessionStart|onGoalCreated|...>');
      process.exit(1);
    }
    await platform.hookEngine.test(event, { test: true, workspace: wsPath });
    console.log(`Hook test dispatched: ${event}`);
    return;
  }

  console.error('Usage: anvio hooks test <event>');
  process.exit(1);
}

async function cmdKanban(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const kanban = createKanbanEngine({ storage });

  switch (action) {
    case 'list': {
      const columnIdx = sub.indexOf('--column');
      const column = columnIdx >= 0 ? (sub[columnIdx + 1] as import('@anvio/core').KanbanColumn) : undefined;
      const tasks = await kanban.listTasks(undefined, column);
      if (tasks.length === 0) {
        console.log('No kanban tasks. Create one: anvio kanban create --title "My Task"');
        return;
      }
      for (const task of tasks) {
        const assignees = task.spec.assignees.map((a) => a.id).join(', ') || '-';
        console.log(`  ${task.metadata.id} [${task.spec.column}] ${task.spec.title} — ${assignees}`);
      }
      break;
    }
    case 'create': {
      const titleIdx = sub.indexOf('--title');
      const title = titleIdx >= 0 ? sub[titleIdx + 1] : undefined;
      if (!title) {
        console.error('Usage: anvio kanban create --title <title> [--lane coding]');
        process.exit(1);
      }
      const laneIdx = sub.indexOf('--lane');
      const lane = laneIdx >= 0 ? sub[laneIdx + 1] : undefined;
      const task = await kanban.createTask({ title, lane });
      if (sub.includes('--auto-assign')) {
        await kanban.autoAssign(task.metadata.id);
      }
      console.log(`Created task: ${task.metadata.id}`);
      break;
    }
    case 'move': {
      const taskId = sub[1];
      const columnIdx = sub.indexOf('--column');
      const column = columnIdx >= 0 ? (sub[columnIdx + 1] as import('@anvio/core').KanbanColumn) : undefined;
      if (!taskId || !column) {
        console.error('Usage: anvio kanban move <taskId> --column <backlog|todo|doing|review|done>');
        process.exit(1);
      }
      const task = await kanban.moveTask(taskId, column);
      console.log(`Moved ${task.metadata.id} → ${task.spec.column}`);
      break;
    }
    case 'assign': {
      const taskId = sub[1];
      const agentIdx = sub.indexOf('--agent');
      const agentId = agentIdx >= 0 ? sub[agentIdx + 1] : undefined;
      if (!taskId || !agentId) {
        console.error('Usage: anvio kanban assign <taskId> --agent <agentId>');
        process.exit(1);
      }
      const task = await kanban.assignAgent(taskId, agentId);
      console.log(`Assigned ${agentId} to ${task.metadata.id}`);
      break;
    }
    default:
      console.error('Usage: anvio kanban list|create|move|assign');
      process.exit(1);
  }
}

async function cmdBatch(sub: string[]) {
  const action = sub[0] ?? 'run';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const platform = await getPlatform();
  const batch = createBatchEngine({
    storage,
    workspaceRoot: wsPath,
    blueprintRunner: {
      run: (blueprint, inputs, options) =>
        platform.blueprintExecutor.run(blueprint, inputs, options),
    },
  });

  switch (action) {
    case 'run': {
      const blueprint = sub[1];
      const inputIdx = sub.indexOf('--input');
      const inputPath = inputIdx >= 0 ? sub[inputIdx + 1] : undefined;
      const concurrencyIdx = sub.indexOf('--concurrency');
      const concurrency = concurrencyIdx >= 0 ? Number(sub[concurrencyIdx + 1]) : 3;
      const dryRun = sub.includes('--dry-run');
      if (!blueprint) {
        console.error('Usage: anvio batch run <blueprint> [--input file.txt] [--concurrency N] [--dry-run]');
        process.exit(1);
      }
      const result = await batch.run(
        {
          name: `Batch ${blueprint}`,
          blueprint,
          input: inputPath
            ? { type: 'file', path: inputPath, items: [], itemTemplate: { repository: '{{line}}' } }
            : { type: 'inline', items: [{ userId: 'local-user' }] },
          concurrency,
          retry: { maxAttempts: 3, backoff: 'exponential', delayMs: 1000, retryOn: ['timeout', 'rate_limit'] },
          dryRun,
        },
        undefined,
        { dryRun },
      );
      console.log(JSON.stringify({ jobId: result.jobId, status: result.status, progress: result.progress }, null, 2));
      break;
    }
    case 'status': {
      const jobId = sub[1];
      if (!jobId) {
        console.error('Usage: anvio batch status <jobId>');
        process.exit(1);
      }
      const status = await batch.getStatus(jobId);
      const progress = await batch.getProgress(jobId);
      console.log(JSON.stringify({ status, progress }, null, 2));
      break;
    }
    case 'resume': {
      const jobId = sub[1];
      const retryFailed = sub.includes('--retry-failed');
      if (!jobId) {
        console.error('Usage: anvio batch resume <jobId> [--retry-failed]');
        process.exit(1);
      }
      const result = await batch.resume(jobId, retryFailed);
      console.log(JSON.stringify({ jobId: result.jobId, status: result.status, progress: result.progress }, null, 2));
      break;
    }
    case 'cancel': {
      const jobId = sub[1];
      if (!jobId) {
        console.error('Usage: anvio batch cancel <jobId>');
        process.exit(1);
      }
      await batch.cancel(jobId);
      console.log(`Batch cancelled: ${jobId}`);
      break;
    }
    default:
      console.error('Usage: anvio batch run|status|resume|cancel');
      process.exit(1);
  }
}

async function cmdRuntime(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const ws = platform.workspace;
  const factory = createRuntimeFactory({
    agentRuntime: platform.runtime,
    options: {
      defaultRuntime: ws.config.spec.runtime.default,
      acpEndpoint: ws.config.spec.acp.enabled
        ? `http://${ws.config.spec.acp.host}:${ws.config.spec.acp.port}`
        : undefined,
    },
  });

  switch (action) {
    case 'list': {
      const runtimes = factory.list();
      for (const rt of runtimes) {
        console.log(`  ${rt.id} [${rt.configured ? 'configured' : 'stub'}] streaming=${rt.capabilities.supportsStreaming}`);
      }
      break;
    }
    case 'test': {
      const id = (sub[1] ?? 'cursor') as import('@anvio/core').RuntimeProviderId;
      const provider = factory.get(id);
      console.log(JSON.stringify({
        id: provider.runtimeId,
        configured: provider.isConfigured(),
        capabilities: provider.capabilities(),
      }, null, 2));
      if (!provider.isConfigured()) {
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error('Usage: anvio runtime list|test [cursor|claude-code|codex|local]');
      process.exit(1);
  }
}

async function cmdExecution(sub: string[]) {
  const action = sub[0] ?? 'run';
  const wsPath = resolveWorkspacePath();
  const ws = await Workspace.open(wsPath);
  const storage = new FilesystemStorageProvider(wsPath);
  const executor = createCodeExecutor({
    storage,
    workspaceRoot: wsPath,
    defaultTimeoutMs: ws.config.spec.execution.defaultTimeoutMs,
    networkEnabled: ws.config.spec.execution.networkEnabled,
  });

  switch (action) {
    case 'run': {
      const runtimeIdx = sub.indexOf('--runtime');
      const runtime = (runtimeIdx >= 0 ? sub[runtimeIdx + 1] : 'python') as import('@anvio/core').CodeRuntime;
      const codeIdx = sub.indexOf('--code');
      const code = codeIdx >= 0 ? sub[codeIdx + 1] : undefined;
      const timeoutIdx = sub.indexOf('--timeout');
      const timeoutMs = timeoutIdx >= 0 ? Number(sub[timeoutIdx + 1]) : ws.config.spec.execution.defaultTimeoutMs;
      if (!code) {
        console.error('Usage: anvio exec run --runtime python|node|shell|go --code "<code>" [--timeout ms]');
        process.exit(1);
      }
      const result = await executor.execute({ runtime, code, timeoutMs });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'audit': {
      const auditId = sub[1];
      if (!auditId) {
        console.error('Usage: anvio exec audit <auditId>');
        process.exit(1);
      }
      const log = new ExecutionAuditLog(storage);
      const record = await log.get(auditId);
      if (!record) {
        console.error(`Audit record not found: ${auditId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(record, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio exec run|audit');
      process.exit(1);
  }
}

let acpServerInstance: ReturnType<typeof createAcpServer> | null = null;

async function cmdAcp(sub: string[]) {
  const action = sub[0] ?? 'status';
  const wsPath = resolveWorkspacePath();
  const ws = await Workspace.open(wsPath);
  const { host, port } = ws.config.spec.acp;

  switch (action) {
    case 'serve': {
      if (acpServerInstance?.getStatus().running) {
        console.log(`ACP server already running on http://${host}:${port}`);
        return;
      }
      const platform = await getPlatform();
      acpServerInstance = createAcpServer({ host, port }, async (request) => {
        const agent = await loadAgent(platform.workspace, request.agent);
        const userId = request.userId ?? ws.config.spec.defaultUserId;
        const stored = await platform.workspace.sessions.create({
          userId,
          agentName: request.agent,
          channel: 'acp',
          messages: [],
          status: 'idle',
          detached: true,
        });
        const session = storedSessionToRuntime(stored);
        const result = await platform.runtime.run(session, agent, { content: request.message });
        return { sessionId: stored.id, content: result.content, status: result.status };
      });
      await acpServerInstance.start();
      console.log(`ACP server listening on http://${host}:${port}`);
      console.log('Endpoints: GET /health, POST /prompt');
      await new Promise<void>(() => {});
      break;
    }
    case 'status': {
      const status = acpServerInstance?.getStatus() ?? { running: false, host, port, connections: 0 };
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio acp serve|status');
      process.exit(1);
  }
}

async function cmdCredentials(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const passphrase = process.env.ANVIO_CREDENTIALS_PASSPHRASE ?? 'local-dev-passphrase';
  const manager = createCredentialPoolManager(storage, passphrase);

  switch (action) {
    case 'list': {
      const pools = await manager.listPools();
      if (pools.length === 0) {
        console.log('No credential pools. Add: anvio credentials add anthropic --id key1 --value $KEY');
        return;
      }
      for (const pool of pools) {
        console.log(`  ${pool.metadata.slug} (${pool.spec.credentials.length} credentials)`);
      }
      break;
    }
    case 'add': {
      const pool = sub[1];
      const idIdx = sub.indexOf('--id');
      const valueIdx = sub.indexOf('--value');
      const id = idIdx >= 0 ? sub[idIdx + 1] : undefined;
      const value = valueIdx >= 0 ? sub[valueIdx + 1] : undefined;
      if (!pool || !id || !value) {
        console.error('Usage: anvio credentials add <pool> --id <id> --value <secret>');
        process.exit(1);
      }
      await manager.addCredential(pool, id, value);
      console.log(`Credential added to pool ${pool}: ${id}`);
      break;
    }
    case 'test': {
      const pool = sub[1];
      if (!pool) {
        console.error('Usage: anvio credentials test <pool>');
        process.exit(1);
      }
      const result = await manager.testPool(pool);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio credentials list|add|test');
      process.exit(1);
  }
}

async function cmdRouting(sub: string[]) {
  const action = sub[0] ?? 'show';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const platform = await getPlatform();
  const router = createModelRouter({
    storage,
    providers: platform.modelProviders.asMap(),
  });

  switch (action) {
    case 'show': {
      const routing = await router.loadRouting();
      console.log(JSON.stringify(routing, null, 2));
      break;
    }
    case 'providers': {
      console.log('Configured model providers:');
      for (const id of platform.modelProviders.listConfigured()) {
        console.log(`  ${id}`);
      }
      break;
    }
    case 'catalog': {
      console.log('Supported model providers:');
      for (const id of MODEL_PROVIDER_IDS) {
        const spec = OPENAI_COMPATIBLE_PROVIDER_SPECS[id];
        if (spec) {
          console.log(`  ${id} (${spec.apiKeyEnv}) — default: ${spec.defaultModel}`);
        } else if (id === 'anthropic') {
          console.log('  anthropic (ANTHROPIC_API_KEY) — Claude models');
        } else if (id === 'gemini') {
          console.log('  gemini (GEMINI_API_KEY / GOOGLE_API_KEY)');
        } else if (id === 'custom') {
          console.log('  custom (baseUrl + apiKeyEnv in agent YAML)');
        }
      }
      break;
    }
    case 'test': {
      const route = sub[1] ?? 'coding';
      const inputIdx = sub.indexOf('--input');
      const message = inputIdx >= 0 ? sub.slice(inputIdx + 1).join(' ') : 'implement middleware';
      const result = await router.chat({
        messages: [{ role: 'user', content: message }],
        routeOverride: route as import('@anvio/models').TaskRoute,
      });
      console.log(JSON.stringify({
        route,
        selectedProvider: result.selectedProvider,
        failover: result.failover,
        content: result.content.slice(0, 200),
      }, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio routing show|providers|catalog|test [route] [--input message]');
      process.exit(1);
  }
}

async function cmdSkill(sub: string[]) {
  const action = sub[0] ?? 'catalog';
  const wsPath = resolveWorkspacePath();
  const repoRoot = findRepoRoot(wsPath);
  const catalog = createSkillCatalogResolver(wsPath, repoRoot);
  const installer = createSkillInstaller(catalog, wsPath);

  switch (action) {
    case 'catalog': {
      const sourceIdx = sub.indexOf('--source');
      const source = sourceIdx >= 0 ? sub[sourceIdx + 1] : 'all';
      const items = source === 'bundled' ? await catalog.listBundled() : await catalog.listAll();
      for (const item of items) {
        if (typeof item === 'string') console.log(`  ${item}`);
        else console.log(`  ${item.slug} [${item.source}]`);
      }
      break;
    }
    case 'install': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio skill install <slug>');
        process.exit(1);
      }
      const skill = await installer.install(slug);
      console.log(`Installed skill: ${skill.metadata.slug}@${skill.metadata.version}`);
      break;
    }
    case 'validate': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio skill validate <file.yaml>');
        process.exit(1);
      }
      const raw = await fs.readFile(path.resolve(file), 'utf8');
      const skill = parseSkillDefinition(parseYaml(raw));
      console.log(JSON.stringify({ slug: skill.metadata.slug, valid: true }, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio skill catalog|install|validate');
      process.exit(1);
  }
}

async function cmdMcp(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const registry = createIntegrationRegistry(storage);
  await registry.load();
  const bridge = createMcpBridge(registry);

  switch (action) {
    case 'list': {
      const entries = await registry.list();
      for (const entry of entries) {
        console.log(`  ${entry.id} [${entry.enabled ? 'enabled' : 'disabled'}] ${entry.server.command}`);
      }
      break;
    }
    case 'test': {
      const serverId = sub[1];
      if (!serverId) {
        console.error('Usage: anvio mcp test <serverId>');
        process.exit(1);
      }
      const result = await bridge.testServer(serverId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio mcp list|test');
      process.exit(1);
  }
}

async function cmdWorkspace(sub: string[]) {
  const action = sub[0] ?? 'validate';
  const wsPath = resolveWorkspacePath();

  switch (action) {
    case 'validate': {
      const issues: string[] = [];
      try {
        await Workspace.open(wsPath);
      } catch (error) {
        issues.push(`anvio.yaml: ${error instanceof Error ? error.message : String(error)}`);
      }

      for (const dir of WORKSPACE_DIRS) {
        try {
          await fs.access(path.join(wsPath, dir));
        } catch {
          issues.push(`missing directory: ${dir}/`);
        }
      }

      const configFiles = ['providers/routing.yaml', 'mcp/servers.yaml', 'hooks/hooks.yaml'] as const;
      for (const file of configFiles) {
        try {
          await fs.access(path.join(wsPath, file));
        } catch {
          issues.push(`missing config: ${file}`);
        }
      }

      if (issues.length > 0) {
        console.error(`Workspace validation failed (${wsPath}):`);
        for (const issue of issues) console.error(`  - ${issue}`);
        process.exit(1);
      }

      console.log(`Workspace OK: ${wsPath}`);
      break;
    }
    default:
      console.error('Usage: anvio workspace validate');
      process.exit(1);
  }
}

async function cmdChat(sub: string[]) {
  const agentFlag = sub.indexOf('--agent');
  const agentName = agentFlag >= 0 ? sub[agentFlag + 1] : undefined;

  const platform = await getPlatform();
  const { workspace, runtime, auth } = platform;

  const name = agentName ?? workspace.config.spec.defaultAgent ?? 'architect';
  const agent = await loadAgent(workspace, name);
  const ctx = auth.getDefaultContext();

  const stored = await workspace.sessions.create({
    userId: ctx.userId,
    agentName: name,
    channel: 'cli',
    messages: [],
    status: 'idle',
  });

  const session = storedSessionToRuntime(stored);
  console.log(`\nAnvio Chat — agent: ${name} (session: ${stored.id})`);
  console.log('Type your message. Ctrl+C to exit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('You: ', async (input) => {
      const content = input.trim();
      if (!content) {
        prompt();
        return;
      }

      process.stdout.write('Assistant: ');
      let full = '';

      for await (const chunk of runtime.stream(session, agent, { content })) {
        if (chunk.type === 'chunk' && chunk.delta) {
          process.stdout.write(chunk.delta);
          full += chunk.delta;
        }
        if (chunk.type === 'error') {
          console.error(`\nError: ${chunk.error}`);
        }
        if (chunk.type === 'done') {
          console.log('\n');
          await workspace.sessions.update(stored.id, {
            messages: [
              ...stored.messages,
              { role: 'user', content },
              { role: 'assistant', content: full },
            ],
          });
          stored.messages.push(
            { role: 'user', content },
            { role: 'assistant', content: full },
          );
        }
      }
      prompt();
    });
  };

  prompt();
}

function resolveWorkspacePath(): string {
  if (process.env.ANVIO_WORKSPACE) return process.env.ANVIO_WORKSPACE;
  return path.resolve(process.cwd(), 'workspace');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
