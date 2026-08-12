import pino, { type Logger, type LoggerOptions } from 'pino';

let rootOverride: Logger | undefined;

function buildRoot(): Logger {
  const level = process.env.ANVIO_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
  const opts: LoggerOptions = {
    level,
    base: { pid: process.pid, service: process.env.ANVIO_SERVICE_NAME ?? 'anvio' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return pino(opts);
}

let rootLogger: Logger | undefined;

function getRoot(): Logger {
  if (rootOverride) return rootOverride;
  if (!rootLogger) rootLogger = buildRoot();
  return rootLogger;
}

/** Structured logger namespaced by module (e.g. createLogger('agents:runtime')). */
export function createLogger(name: string): Logger {
  return getRoot().child({ module: name });
}

/** Test hook — replace the root logger (pass undefined to reset to default). */
export function setRootLogger(logger: Logger | undefined): void {
  rootOverride = logger;
}

export type { Logger };
