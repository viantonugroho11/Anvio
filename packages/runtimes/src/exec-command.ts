import { execFile } from 'node:child_process';

export interface ExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const DEFAULT_REMOTE_EXEC_TIMEOUT_MS = 60_000;

/**
 * Run a command without blocking the event loop. The remote runtimes used
 * `spawnSync` behind `async` methods with no timeout, so a hung `ssh` froze the
 * whole process indefinitely (audit CQ-027). A missing binary still throws;
 * a non-zero exit or a timeout is reported in the result.
 */
export function execCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; maxBufferBytes?: number } = {},
): Promise<ExecCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_EXEC_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: options.maxBufferBytes ?? 10 * 1024 * 1024,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(error);
          return;
        }
        const timedOut = Boolean(error && (error as { killed?: boolean }).killed);
        const code =
          typeof (error as { code?: unknown } | null)?.code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({
          stdout: String(stdout ?? '').trim(),
          stderr: (timedOut
            ? `${String(stderr ?? '')}\nCommand timed out after ${timeoutMs}ms`
            : String(stderr ?? '')
          ).trim(),
          exitCode: timedOut ? 124 : code,
        });
      },
    );
  });
}
