// Where shell and file tools run (ADR 0034). The default target is the Anvio host;
// a session bound with `/remote` gets a target on the user's own machine while the
// model loop, credentials and memory stay on the host.

export interface ExecOptions {
  stdin?: string;
  timeoutMs: number;
  /** Run under a login shell (user's PATH/profile). */
  login?: boolean;
  /** Characters of stdout kept before truncating (default 30_000). */
  maxOutput?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
  timedOut: boolean;
}

export interface ExecTarget {
  /** Short label for logs and `/remote status`, e.g. `local` or `tailnet:host:/dir`. */
  readonly label: string;
  exec(command: string, options: ExecOptions): Promise<ExecResult>;
  readFile(relativePath: string, maxChars?: number): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  listDir(relativePath: string): Promise<Array<{ name: string; type: 'file' | 'dir' | 'other' }>>;
}

export type RemoteErrorCode = 'REMOTE_UNREACHABLE' | 'REMOTE_AUTH_FAILED';

/**
 * Transport-level failure of a remote target. Tool-level failures (non-zero exit,
 * missing file) are ordinary results. `started` means the command may already have
 * run remotely, so callers must never retry it automatically.
 */
export class RemoteExecError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    readonly started = false,
  ) {
    super(`${code}: ${message}`);
    this.name = 'RemoteExecError';
  }
}
