import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface ScriptHandlerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runScriptHandler(
  workspaceRoot: string,
  scriptPath: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<ScriptHandlerResult> {
  const absPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(workspaceRoot, scriptPath);

  await fs.access(absPath);

  return new Promise((resolve, reject) => {
    const child = spawn(absPath, [], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
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
      reject(new Error(`Hook script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
