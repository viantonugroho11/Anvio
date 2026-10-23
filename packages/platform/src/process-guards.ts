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
