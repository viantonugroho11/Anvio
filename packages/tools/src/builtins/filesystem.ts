import type { CodeExecutor } from '@anvio/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function fileRead(
  workspaceRoot: string,
  relativePath: string,
  maxChars = 16_000,
): Promise<{ path: string; content: string }> {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(path.resolve(workspaceRoot))) {
    throw new Error('Path escapes workspace');
  }
  const content = await fs.readFile(resolved, 'utf-8');
  return { path: relativePath, content: content.slice(0, maxChars) };
}

export async function fileWrite(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(path.resolve(workspaceRoot))) {
    throw new Error('Path escapes workspace');
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
  return { path: relativePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

export async function executeCodeWithExecutor(
  executor: CodeExecutor,
  code: string,
  language = 'javascript',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const runtime =
    language === 'python' ? 'python' : language === 'javascript' || language === 'node' ? 'node' : 'shell';
  const result = await executor.execute({ code, runtime, timeoutMs: 30_000 });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
