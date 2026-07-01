import { spawn } from 'node:child_process';

export interface SpawnVendorCliOptions {
  binary: string;
  args: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnVendorCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function spawnVendorCli(
  options: SpawnVendorCliOptions,
): Promise<SpawnVendorCliResult> {
  const timeoutMs = options.timeoutMs ?? 300_000;

  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, options.args, {
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

export function combinedOutput(result: SpawnVendorCliResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}
