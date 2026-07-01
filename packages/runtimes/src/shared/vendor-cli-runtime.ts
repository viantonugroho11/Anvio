import { spawn } from 'node:child_process';

export interface RunVendorCliOptions {
  binary: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface RunVendorCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function runVendorCliCommand(
  options: RunVendorCliOptions,
): Promise<RunVendorCliResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;

  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, options.args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${options.binary} ${options.args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export function combinedVendorOutput(result: RunVendorCliResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

/** Remove API keys that shadow vendor subscription OAuth. */
export function stripEnvKeys(env: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}
