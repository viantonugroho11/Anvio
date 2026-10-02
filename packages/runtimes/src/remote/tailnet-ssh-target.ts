import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ExecOptions, ExecResult, ExecTarget } from '@anvio/core';
import { RemoteExecError } from '@anvio/core';

/** Minimal spawn surface so tests can replace the ssh binary. */
export type SshSpawn = (
  args: string[],
  stdin: string | undefined,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>;

export interface TailnetSshTargetOptions {
  /** `host`, `user@host` or `user@host:port` on the tailnet (tailcat / Tailscale SSH). */
  address: string;
  /** Absolute directory on the remote machine; every tool path is resolved under it. */
  dir: string;
  /** Private key generated for this (workspace, user); see ensureRemoteKey. */
  identityFile: string;
  /** Host keys for remote targets only, so the operator's ~/.ssh/known_hosts is untouched. */
  knownHostsFile: string;
  spawnSsh?: SshSpawn;
}

const SSH_TRANSPORT_EXIT = 255;
const DEFAULT_MAX_OUTPUT = 30_000;

/** POSIX single-quote escaping for one shell word. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function defaultSpawn(args: string[], stdin: string | undefined, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve) => {
    const proc = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}${error.message}`, code: SSH_TRANSPORT_EXIT, timedOut });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    proc.stdin.end(stdin ?? '');
  });
}

/**
 * ExecTarget over SSH to the user's machine on a tailnet (ADR 0034). The model loop,
 * credentials and memory stay on the Anvio host; only tool I/O crosses the wire.
 */
export class TailnetSshTarget implements ExecTarget {
  readonly label: string;
  private readonly spawnSsh: SshSpawn;
  private readonly host: string;
  private readonly port?: string;

  constructor(private readonly options: TailnetSshTargetOptions) {
    const match = /^(.*?)(?::(\d+))?$/.exec(options.address)!;
    this.host = match[1]!;
    this.port = match[2];
    if (!path.posix.isAbsolute(options.dir)) throw new Error('remote dir must be absolute');
    this.label = `tailnet:${this.host}:${options.dir}`;
    this.spawnSsh = options.spawnSsh ?? defaultSpawn;
  }

  private sshArgs(remoteCommand: string): string[] {
    return [
      '-i', this.options.identityFile,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${this.options.knownHostsFile}`,
      ...(this.port ? ['-p', this.port] : []),
      this.host,
      '--',
      remoteCommand,
    ];
  }

  /** Resolve a tool path under the bound dir; refuses escapes like `../../etc`. */
  private remotePath(relativePath: string): string {
    const resolved = path.posix.resolve(this.options.dir, relativePath || '.');
    if (resolved !== this.options.dir && !resolved.startsWith(`${this.options.dir.replace(/\/$/, '')}/`)) {
      throw new Error('Path escapes the remote directory');
    }
    return resolved;
  }

  private async run(remoteCommand: string, stdin: string | undefined, timeoutMs: number) {
    const out = await this.spawnSsh(this.sshArgs(remoteCommand), stdin, timeoutMs);
    if (out.code === SSH_TRANSPORT_EXIT) {
      const started = out.stdout.length > 0;
      if (/Permission denied|Host key verification failed/i.test(out.stderr)) {
        throw new RemoteExecError('REMOTE_AUTH_FAILED', out.stderr.trim().split('\n').at(-1) ?? 'auth failed', started);
      }
      throw new RemoteExecError('REMOTE_UNREACHABLE', out.stderr.trim().split('\n').at(-1) || 'ssh failed', started);
    }
    return out;
  }

  async exec(command: string, options: ExecOptions): Promise<ExecResult> {
    const shell = options.login ? 'bash -lc' : 'sh -c';
    const out = await this.run(
      `cd ${shellQuote(this.options.dir)} && ${shell} ${shellQuote(command)}`,
      options.stdin,
      options.timeoutMs,
    );
    const max = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
    return {
      stdout: out.stdout.slice(0, max),
      stderr: out.stderr.slice(0, max),
      code: out.timedOut ? null : out.code,
      truncated: out.stdout.length > max,
      timedOut: out.timedOut,
    };
  }

  async readFile(relativePath: string, maxChars = 16_000): Promise<string> {
    const out = await this.run(`cat -- ${shellQuote(this.remotePath(relativePath))}`, undefined, 30_000);
    if (out.code !== 0) throw new Error(out.stderr.trim() || `cannot read ${relativePath}`);
    return out.stdout.slice(0, maxChars);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const file = this.remotePath(relativePath);
    const out = await this.run(
      `mkdir -p -- ${shellQuote(path.posix.dirname(file))} && cat > ${shellQuote(file)}`,
      content,
      30_000,
    );
    if (out.code !== 0) throw new Error(out.stderr.trim() || `cannot write ${relativePath}`);
  }

  async listDir(relativePath: string): Promise<Array<{ name: string; type: 'file' | 'dir' | 'other' }>> {
    const out = await this.run(`ls -1Ap -- ${shellQuote(this.remotePath(relativePath))}`, undefined, 30_000);
    if (out.code !== 0) throw new Error(out.stderr.trim() || `cannot list ${relativePath}`);
    return out.stdout
      .split('\n')
      .filter(Boolean)
      .map((name) => (name.endsWith('/') ? { name: name.slice(0, -1), type: 'dir' as const } : { name, type: 'file' as const }));
  }
}
