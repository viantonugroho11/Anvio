// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import { createPlatform, exitOnShutdownSignals, runShutdownSteps } from '@anvio/platform';
import path from 'node:path';

export async function getPlatform() {
  const wsPath = resolveWorkspacePath();
  // One-shot CLI commands must not start inbound channel pollers — a
  // long-poll against Telegram from `anvio run` races the gateway for the
  // same getUpdates and silently drops messages (issue #48). The gateway
  // and worker entrypoints opt back in via their own createPlatform calls.
  const platform = await createPlatform({ workspacePath: wsPath, startChannels: false });
  registerShutdownOnExit(platform.shutdown);
  return platform;
}

let shutdownRegistered = false;

export function registerShutdownOnExit(shutdown: () => Promise<void>): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  // `beforeExit` fires when the event loop drains on its own; signals used to call
  // process.exit right after *starting* the async shutdown, so it never finished
  // (audit CQ-015). Now the exit waits for it, capped by a timeout.
  process.once('beforeExit', () => {
    void shutdown().catch((error: unknown) => {
      console.error('[cli] shutdown failed:', error instanceof Error ? error.message : error);
    });
  });
  exitOnShutdownSignals(
    'cli',
    () => runShutdownSteps('cli', [{ name: 'platform', run: shutdown }], 5_000),
    {
      SIGINT: 130,
      SIGTERM: 143,
    },
  );
}

/** Reads a secret piped on stdin, so it never appears in argv. */
export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

export function gatewayPidPath(wsPath: string): string {
  return path.join(wsPath, '.gateway', 'gateway.pid');
}

export function resolveWorkspacePath(): string {
  if (process.env.ANVIO_WORKSPACE) return process.env.ANVIO_WORKSPACE;
  return path.resolve(process.cwd(), 'workspace');
}
