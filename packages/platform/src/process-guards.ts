let installed = false;

/**
 * Keeps one stray promise from stopping the daemon.
 *
 * Node exits on an unhandled rejection, so a single channel callback that
 * forgot a `catch` took every channel, the worker and the API down together
 * (audit T-005). The rejection is logged and the process keeps serving.
 *
 * An uncaught *exception* still ends the process: the throwing code may have
 * left shared state half-updated, and continuing on it is worse than a restart.
 */
export function installProcessErrorGuards(label = 'anvio'): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    console.error(
      `[${label}] Unhandled promise rejection (process kept running):`,
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
  });

  process.on('uncaughtException', (error) => {
    console.error(`[${label}] Uncaught exception, exiting:`, error.stack ?? error.message);
    process.exit(1);
  });
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown> | unknown;
}

/**
 * Run shutdown steps in order, logging (not swallowing) failures, then resolve.
 * The whole sequence is capped by `timeoutMs` so one hung subsystem cannot keep
 * the process alive past a container's SIGKILL grace period.
 */
export async function runShutdownSteps(
  label: string,
  steps: ShutdownStep[],
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<{ timedOut: boolean; failed: string[] }> {
  const failed: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sequence = (async () => {
    for (const step of steps) {
      try {
        await step.run();
      } catch (error) {
        failed.push(step.name);
        console.error(
          `[${label}] shutdown step "${step.name}" failed:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
      }
    }
    return false;
  })();
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
    timer.unref?.();
  });
  const timedOut = await Promise.race([sequence, deadline]);
  if (timer) clearTimeout(timer);
  if (timedOut)
    console.error(`[${label}] shutdown did not finish within ${timeoutMs}ms; exiting anyway`);
  return { timedOut, failed };
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdownHandlers: Array<{ label: string; shutdown: () => Promise<unknown> }> = [];
let signalExitCodes: { SIGINT?: number; SIGTERM?: number } = {};
let signalsInstalled = false;

/**
 * Exit cleanly on SIGINT and SIGTERM after running every registered shutdown, in
 * registration order. Containers stop with SIGTERM; the worker used to listen for
 * SIGINT only, so `docker stop` killed it without cleanup (audit CQ-015). A second
 * signal while shutting down exits immediately.
 */
export function exitOnShutdownSignals(
  label: string,
  shutdown: () => Promise<unknown>,
  exitCodes: { SIGINT?: number; SIGTERM?: number } = {},
): void {
  shutdownHandlers.push({ label, shutdown });
  signalExitCodes = { ...signalExitCodes, ...exitCodes };
  if (signalsInstalled) return;
  signalsInstalled = true;
  let shuttingDown = false;
  const handle = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      console.error(`[${label}] ${signal} again — exiting now`);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    console.log(`\n[${label}] ${signal} received, shutting down…`);
    void (async () => {
      for (const handler of shutdownHandlers) {
        try {
          await handler.shutdown();
        } catch (error) {
          console.error(
            `[${handler.label}] shutdown failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    })().finally(() => process.exit(signalExitCodes[signal as 'SIGINT' | 'SIGTERM'] ?? 0));
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}
