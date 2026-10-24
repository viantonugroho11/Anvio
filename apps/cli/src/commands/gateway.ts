// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import {
  applyMcpPreset,
  createIntegrationRegistry,
  createMcpBridge,
  listMcpPresets,
} from '@anvio/integrations';
import { exitOnShutdownSignals, startUnifiedGateway } from '@anvio/platform';
import { FilesystemStorageProvider } from '@anvio/storage';
import {
  listTrash,
  moveToTrash,
  pruneTrash,
  restoreFromTrash,
  Workspace,
  WORKSPACE_DIRS,
  type TrashablePrimitive,
} from '@anvio/workspace';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayPidPath, resolveWorkspacePath } from '../cli-context.js';

export async function cmdGateway(sub: string[]) {
  const action = sub[0] ?? 'help';
  const wsPath = resolveWorkspacePath();
  const port = parseInt(process.env.ANVIO_GATEWAY_PORT ?? '3001', 10);

  switch (action) {
    case 'start': {
      const foreground = sub.includes('--foreground') || sub.includes('-f');
      if (foreground) {
        const handle = await startUnifiedGateway({ workspacePath: wsPath });
        console.log(`Gateway running on port ${handle.port} (Ctrl+C to stop)`);
        exitOnShutdownSignals('gateway', () => handle.shutdown());
        return;
      }

      const pidFile = gatewayPidPath(wsPath);
      await fs.mkdir(path.dirname(pidFile), { recursive: true });
      try {
        const existing = await fs.readFile(pidFile, 'utf-8');
        process.kill(parseInt(existing.trim(), 10), 0);
        console.log(`Gateway already running (pid ${existing.trim()}). Use: anvio gateway stop`);
        return;
      } catch {
        /* not running */
      }

      // Re-spawn ourselves in --foreground mode instead of hunting for a
      // separate gateway binary. The old code required a monorepo layout
      // (apps/gateway/dist/main.js under repo root) so `anvio gateway start`
      // installed via scripts/install.sh always exited 1 with "Cannot locate
      // gateway binary" (issue #50). Using argv[1] works in every install
      // layout: monorepo, tarball, npm global, homebrew.
      const cliEntry = process.argv[1];
      if (!cliEntry) {
        console.error('Cannot determine CLI entry point for daemonization.');
        process.exit(1);
      }
      const logDir = path.join(wsPath, 'logs');
      await fs.mkdir(logDir, { recursive: true });
      const logPath = path.join(logDir, 'gateway.log');
      const out = await fs.open(logPath, 'a');
      const child = spawn(process.execPath, [cliEntry, 'gateway', 'start', '--foreground'], {
        detached: true,
        stdio: ['ignore', out.fd, out.fd],
        env: { ...process.env, ANVIO_WORKSPACE: wsPath },
      });
      child.unref();
      await out.close();
      if (child.pid) {
        await fs.writeFile(pidFile, String(child.pid), 'utf-8');
        console.log(`Gateway started (pid ${child.pid}) on port ${port}`);
        console.log(`  anvio gateway status`);
        console.log(`  anvio gateway stop`);
      }
      break;
    }
    case 'stop': {
      const pidFile = gatewayPidPath(wsPath);
      try {
        const pid = parseInt((await fs.readFile(pidFile, 'utf-8')).trim(), 10);
        process.kill(pid, 'SIGTERM');
        await fs.unlink(pidFile);
        console.log(`Gateway stopped (pid ${pid})`);
      } catch {
        console.log('Gateway is not running');
      }
      break;
    }
    case 'status': {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const body = (await res.json()) as Record<string, unknown>;
        console.log(JSON.stringify({ ok: res.ok, port, ...body }, null, 2));
      } catch {
        console.log(JSON.stringify({ ok: false, port, error: 'Gateway not reachable' }, null, 2));
        process.exit(1);
      }
      break;
    }
    default:
      console.log(`anvio gateway — Hermes-style unified daemon

  anvio gateway start [--foreground]   Start gateway (channels + worker + API + WS)
  anvio gateway stop                     Stop background gateway
  anvio gateway status                   Health check

Environment:
  ANVIO_GATEWAY_PORT                   Default 3001
  ANVIO_WORKSPACE                      Workspace path
  storage.provider: sqlite in anvio.yaml for Hermes-style state.db sessions`);
  }
}

export async function cmdMcp(sub: string[]) {
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
        console.log(
          `  ${entry.id} [${entry.enabled ? 'enabled' : 'disabled'}] ${entry.server.command ?? entry.server.url}`,
        );
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
    case 'health': {
      const report = await bridge.getHealthReport();
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case 'preset': {
      const presetAction = sub[1] ?? 'list';
      const wsPath = resolveWorkspacePath();
      switch (presetAction) {
        case 'list': {
          const presets = await listMcpPresets(wsPath);
          if (presets.length === 0) {
            console.log('No MCP presets in workspace/mcp/presets/');
            return;
          }
          for (const name of presets) console.log(`  ${name}`);
          break;
        }
        case 'apply': {
          const name = sub[2];
          if (!name) {
            console.error('Usage: anvio mcp preset apply <name>');
            process.exit(1);
          }
          const merged = await applyMcpPreset(wsPath, name);
          console.log(`Applied preset "${name}" — merged servers: ${merged.join(', ')}`);
          console.log(
            'Edit mcp/servers.yaml to set enabled: true and env values, then: anvio mcp test <serverId>',
          );
          break;
        }
        default:
          console.error('Usage: anvio mcp preset list|apply <name>');
          process.exit(1);
      }
      break;
    }
    default:
      console.error('Usage: anvio mcp list|test|health|preset list|apply <name>');
      process.exit(1);
  }
}

export async function cmdWorkspace(sub: string[]) {
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

      const configFiles = [
        'providers/routing.yaml',
        'mcp/servers.yaml',
        'hooks/hooks.yaml',
      ] as const;
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

export async function cmdTrash(sub: string[]) {
  const wsPath = resolveWorkspacePath();
  const action = sub[0] ?? 'list';

  if (action === 'list') {
    const primitive = (sub[1] as TrashablePrimitive | undefined) ?? undefined;
    const entries = await listTrash(wsPath, primitive);
    if (entries.length === 0) {
      console.log(primitive ? `No trashed ${primitive}s.` : 'Trash is empty.');
      return;
    }
    console.log('Primitive    Slug                          Deleted (UTC)             Entry');
    console.log('─'.repeat(96));
    for (const e of entries) {
      console.log(
        `${e.primitive.padEnd(12)} ${e.slug.padEnd(29)} ${new Date(e.deletedAtMs).toISOString().padEnd(24)} ${e.entryName}`,
      );
    }
    return;
  }

  if (action === 'restore') {
    const primitive = sub[1] as TrashablePrimitive | undefined;
    const entryName = sub[2];
    const force = sub.includes('--force');
    if (!primitive || !entryName) {
      console.error('Usage: anvio trash restore <primitive> <entryName> [--force]');
      process.exit(1);
    }
    try {
      const result = await restoreFromTrash(wsPath, primitive, entryName, { force });
      console.log(
        `Restored ${result.primitive}:${result.slug} → ${result.destPath}${result.overwritten ? ' (previous live file trashed)' : ''}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  if (action === 'rm') {
    const primitive = sub[1] as TrashablePrimitive | undefined;
    const slug = sub[2];
    if (!primitive || !slug) {
      console.error('Usage: anvio trash rm <primitive> <slug>');
      process.exit(1);
    }
    try {
      const result = await moveToTrash(wsPath, primitive, slug);
      console.log(`Trashed ${primitive}:${slug} → ${result.entry.path}`);
      console.log(`Restore with: ${result.restoreCommand}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  if (action === 'prune') {
    const daysIdx = sub.indexOf('--older-than');
    const olderThanDays = daysIdx >= 0 ? parseInt(sub[daysIdx + 1] ?? '30', 10) || 30 : 30;
    const dryRun = sub.includes('--dry-run');
    const result = await pruneTrash(wsPath, { olderThanDays, dryRun });
    const verb = dryRun ? 'Would remove' : 'Removed';
    console.log(
      `${verb} ${result.removed.length} of ${result.scanned} trash entries (older than ${olderThanDays}d).`,
    );
    for (const e of result.removed) {
      console.log(`  ${e.primitive}:${e.slug} (${new Date(e.deletedAtMs).toISOString()})`);
    }
    return;
  }

  console.error('Usage: anvio trash list|rm|restore|prune');
  process.exit(1);
}
