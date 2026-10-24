// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import { createAcpServer } from '@anvio/acp';
import { probeAllChannels, summarizeChannelHealth } from '@anvio/channels';
import type { ChannelHealthReport } from '@anvio/core';
import { createCredentialPoolManager } from '@anvio/credentials';
import { createCodeExecutor, ExecutionAuditLog } from '@anvio/execution';
import {
  createModelRouter,
  MODEL_PROVIDER_IDS,
  OPENAI_COMPATIBLE_PROVIDER_SPECS,
} from '@anvio/models';
import {
  aggregateTokenUsage,
  loadAgent,
  parseUsageLastFlag,
  readTokenUsageAudit,
  storedSessionToRuntime,
} from '@anvio/platform';
import {
  DaytonaRuntimeProvider,
  ModalRuntimeProvider,
  SingularityRuntimeProvider,
  SshRuntimeProvider,
} from '@anvio/runtimes';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { getPlatform, readAllStdin, resolveWorkspacePath } from '../cli-context.js';

export async function cmdWorktree(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const { workspace } = platform;

  if (!workspace.worktrees) {
    console.error(
      'Worktrees disabled. Enable in workspace/anvio.yaml: spec.worktrees.enabled: true',
    );
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

export const STATUS_ICON: Record<ChannelHealthReport['status'], string> = {
  healthy: '✅',
  degraded: '⚠️',
  disabled: '⏸',
  misconfigured: '❌',
  unreachable: '🔴',
};

export async function cmdChannels(sub: string[]) {
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

export async function cmdRuntime(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const factory = platform.runtimeFactory;

  switch (action) {
    case 'list': {
      const runtimes = factory.list();
      for (const rt of runtimes) {
        console.log(
          `  ${rt.id} [${rt.configured ? 'configured' : 'stub'}] streaming=${rt.capabilities.supportsStreaming}`,
        );
      }
      break;
    }
    case 'exec': {
      const id = (sub[1] ?? 'ssh') as import('@anvio/core').RuntimeProviderId;
      const dashIdx = sub.indexOf('--');
      const command = dashIdx >= 0 ? sub.slice(dashIdx + 1).join(' ') : '';
      if (!command) {
        console.error('Usage: anvio runtime exec <ssh|daytona|modal|singularity> -- <command>');
        process.exit(1);
      }
      const provider = factory.get(id);
      if (id === 'ssh') {
        const ssh = provider as SshRuntimeProvider;
        const result = await ssh.execRemote(command);
        console.log(JSON.stringify({ id, ...result }, null, 2));
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
        break;
      }
      if (id === 'daytona' || id === 'modal') {
        const remote = provider as DaytonaRuntimeProvider | ModalRuntimeProvider;
        const result = await remote.execRemote(command);
        console.log(JSON.stringify({ id, ...result }, null, 2));
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
        break;
      }
      if (id === 'singularity') {
        const singularity = provider as SingularityRuntimeProvider;
        const result = await singularity.execRemote(command);
        console.log(JSON.stringify({ id, ...result }, null, 2));
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
        break;
      }
      console.error('exec supported for: ssh, daytona, modal, singularity');
      process.exit(1);
      break;
    }
    case 'test': {
      const id = (sub[1] ?? 'cursor') as import('@anvio/core').RuntimeProviderId;
      const provider = factory.get(id);
      if (id === 'ssh') {
        const ssh = provider as SshRuntimeProvider;
        const probe = await ssh.testConnection();
        console.log(JSON.stringify({ id: provider.runtimeId, ...probe }, null, 2));
        if (!probe.ok) process.exitCode = 1;
        break;
      }
      console.log(
        JSON.stringify(
          {
            id: provider.runtimeId,
            configured: provider.isConfigured(),
            capabilities: provider.capabilities(),
          },
          null,
          2,
        ),
      );
      if (!provider.isConfigured()) {
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error(
        'Usage: anvio runtime list|test|exec <ssh|daytona|modal|singularity> -- <command>',
      );
      process.exit(1);
  }
}

export async function cmdExecution(sub: string[]) {
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
      const runtime = (
        runtimeIdx >= 0 ? sub[runtimeIdx + 1] : 'python'
      ) as import('@anvio/core').CodeRuntime;
      const codeIdx = sub.indexOf('--code');
      const code = codeIdx >= 0 ? sub[codeIdx + 1] : undefined;
      const timeoutIdx = sub.indexOf('--timeout');
      const timeoutMs =
        timeoutIdx >= 0 ? Number(sub[timeoutIdx + 1]) : ws.config.spec.execution.defaultTimeoutMs;
      if (!code) {
        console.error(
          'Usage: anvio exec run --runtime python|node|shell|go --code "<code>" [--timeout ms]',
        );
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

export async function cmdAcp(sub: string[]) {
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
      const runPrompt = async (request: {
        agent: string;
        message: string;
        userId?: string;
        sessionId?: string;
      }) => {
        const agent = await loadAgent(platform.workspace, request.agent);
        const userId = request.userId ?? ws.config.spec.defaultUserId;
        let stored = request.sessionId
          ? await platform.workspace.sessions.get(request.sessionId)
          : null;
        if (!stored) {
          stored = await platform.workspace.sessions.create({
            userId,
            agentName: request.agent,
            channel: 'acp',
            messages: [],
            status: 'idle',
            detached: true,
          });
        }
        const session = storedSessionToRuntime(stored);
        const result = await platform.runtime.run(session, agent, { content: request.message });
        return { sessionId: stored.id, content: result.content, status: result.status };
      };

      acpServerInstance = createAcpServer({ host, port }, runPrompt, async (request, emit) => {
        const agent = await loadAgent(platform.workspace, request.agent);
        const userId = request.userId ?? ws.config.spec.defaultUserId;
        let stored = request.sessionId
          ? await platform.workspace.sessions.get(request.sessionId)
          : null;
        if (!stored) {
          stored = await platform.workspace.sessions.create({
            userId,
            agentName: request.agent,
            channel: 'acp',
            messages: [],
            status: 'idle',
            detached: true,
          });
        }
        const session = storedSessionToRuntime(stored);
        let content = '';
        for await (const chunk of platform.runtime.stream(session, agent, {
          content: request.message,
        })) {
          if (chunk.type === 'chunk' && chunk.delta) {
            content += chunk.delta;
            emit({ type: 'chunk', delta: chunk.delta });
          }
          if (chunk.type === 'error') emit({ type: 'error', error: chunk.error });
        }
        return { sessionId: stored.id, content, status: 'completed' };
      });
      await acpServerInstance.start();
      console.log(`ACP server listening on http://${host}:${port}`);
      console.log('Endpoints: GET /health, POST /prompt, POST /prompt/stream');
      await new Promise<void>(() => {});
      break;
    }
    case 'status': {
      const status = acpServerInstance?.getStatus() ?? {
        running: false,
        host,
        port,
        connections: 0,
      };
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio acp serve|status');
      process.exit(1);
  }
}

export async function cmdCredentials(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const passphrase = process.env.ANVIO_CREDENTIALS_PASSPHRASE;
  if (!passphrase) {
    console.error(
      'Set ANVIO_CREDENTIALS_PASSPHRASE to use credential pools.\n' +
        '  Credentials are encrypted at rest with a key derived from it, and the salt is\n' +
        '  stored beside the ciphertext — so a default passphrase would protect nothing.\n' +
        '  Pools written under the previous built-in default cannot be read with a new\n' +
        '  passphrase; re-add those credentials with `anvio credentials add`.',
    );
    process.exit(1);
  }
  const manager = createCredentialPoolManager(storage, passphrase);

  switch (action) {
    case 'list': {
      const pools = await manager.listPools();
      if (pools.length === 0) {
        console.log(
          'No credential pools. Add: anvio credentials add anthropic --id key1 --value $KEY',
        );
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
      const valueEnvIdx = sub.indexOf('--value-env');
      const id = idIdx >= 0 ? sub[idIdx + 1] : undefined;

      // A secret passed as `--value <secret>` sits in the process argv, which is
      // world-readable in `ps` and lands in shell history. Reading it from stdin
      // or an env var keeps it off both.
      let value: string | undefined;
      if (valueEnvIdx >= 0) {
        const envName = sub[valueEnvIdx + 1];
        if (!envName) {
          console.error('Usage: anvio credentials add <pool> --id <id> --value-env <ENV_NAME>');
          process.exit(1);
        }
        value = process.env[envName];
        if (!value) {
          console.error(`Environment variable ${envName} is empty or unset`);
          process.exit(1);
        }
      } else if (valueIdx >= 0 && sub[valueIdx + 1] === '-') {
        value = (await readAllStdin()).trim();
        if (!value) {
          console.error('No key received on stdin');
          process.exit(1);
        }
      } else if (valueIdx >= 0) {
        value = sub[valueIdx + 1];
        console.warn(
          "Warning: --value puts the key in this process's argv, visible to `ps` and saved in shell history.\n" +
            '  Prefer: anvio credentials add <pool> --id <id> --value -      (reads stdin)\n' +
            '      or: anvio credentials add <pool> --id <id> --value-env ANTHROPIC_API_KEY',
        );
      }

      if (!pool || !id || !value) {
        console.error(
          'Usage: anvio credentials add <pool> --id <id> (--value - | --value-env <ENV> | --value <secret>)',
        );
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

export async function cmdUsage(sub: string[]) {
  const action = sub[0] ?? 'stats';
  if (action !== 'stats') {
    console.error('Usage: anvio usage stats [--json] [--last 24h]');
    process.exit(1);
  }

  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const records = await readTokenUsageAudit(storage);
  const sinceHours = parseUsageLastFlag(sub);
  const stats = aggregateTokenUsage(records, { sinceHours });

  if (sub.includes('--json')) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const windowLabel = sinceHours != null ? `last ${sinceHours}h` : 'all time';
  console.log(`\nToken Usage (${windowLabel})\n`);
  console.log(`Runs:          ${stats.runs}`);
  console.log(`Input tokens:  ${stats.inputTokens}`);
  console.log(`Output tokens: ${stats.outputTokens}`);
  console.log(`Total tokens:  ${stats.totalTokens}`);
  console.log(`Est. cost USD: $${stats.estimatedCostUsd.toFixed(6)}`);
  if (Object.keys(stats.byAgent).length) {
    console.log('\nBy agent:');
    for (const [agent, row] of Object.entries(stats.byAgent)) {
      console.log(`  ${agent}: ${row.totalTokens} tokens ($${row.estimatedCostUsd.toFixed(6)})`);
    }
  }
  if (Object.keys(stats.byChannel).length) {
    console.log('\nBy channel:');
    for (const [channel, row] of Object.entries(stats.byChannel)) {
      console.log(`  ${channel}: ${row.totalTokens} tokens ($${row.estimatedCostUsd.toFixed(6)})`);
    }
  }
  console.log('');
}

export async function cmdRouting(sub: string[]) {
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
      console.log(
        JSON.stringify(
          {
            route,
            selectedProvider: result.selectedProvider,
            failover: result.failover,
            content: result.content.slice(0, 200),
          },
          null,
          2,
        ),
      );
      break;
    }
    default:
      console.error('Usage: anvio routing show|providers|catalog|test [route] [--input message]');
      process.exit(1);
  }
}
