import { pino, type Logger } from 'pino';

let root: Logger | undefined;

function rootLogger(): Logger {
  if (!root) {
    root = pino({
      level: process.env.ANVIO_LOG_LEVEL ?? 'info',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return root;
}

/** Structured logger namespaced by module (e.g. createLogger('agents:runtime')). */
export function createLogger(name: string): Logger {
  return rootLogger().child({ module: name });
}

/** Test hook — replace the root logger (pass undefined to reset to default). */
export function setRootLogger(logger: Logger | undefined): void {
  root = logger;
}

export type { Logger };
