import type { CodeExecutor } from '@anvio/core';
import fs from 'node:fs/promises';
import path from 'node:path';

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(path.resolve(workspaceRoot))) {
    throw new Error('Path escapes workspace');
  }
  return resolved;
}

export async function fileRead(
  workspaceRoot: string,
  relativePath: string,
  maxChars = 16_000,
): Promise<{ path: string; content: string }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const content = await fs.readFile(resolved, 'utf-8');
  return { path: relativePath, content: content.slice(0, maxChars) };
}

export async function fileWrite(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
  return { path: relativePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

export async function listDir(
  workspaceRoot: string,
  relativePath = '.',
): Promise<{ path: string; entries: Array<{ name: string; type: 'file' | 'dir'; size?: number }> }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error('Not a directory');
  }
  const dirents = await fs.readdir(resolved, { withFileTypes: true });
  const entries: Array<{ name: string; type: 'file' | 'dir'; size?: number }> = [];
  for (const entry of dirents) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, type: 'dir' });
    } else if (entry.isFile()) {
      const fileStat = await fs.stat(path.join(resolved, entry.name));
      entries.push({ name: entry.name, type: 'file', size: fileStat.size });
    }
  }
  return { path: relativePath, entries };
}

export async function editFile(
  workspaceRoot: string,
  relativePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<{ path: string; replacements: number; bytes: number }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const content = await fs.readFile(resolved, 'utf-8');
  if (!content.includes(oldString)) {
    throw new Error('old_string not found in file');
  }
  const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
  const updated = replaceAll
    ? content.replaceAll(oldString, newString)
    : content.replace(oldString, newString);
  await fs.writeFile(resolved, updated, 'utf-8');
  return { path: relativePath, replacements, bytes: Buffer.byteLength(updated, 'utf-8') };
}

export async function pathExists(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ path: string; exists: boolean; type?: 'file' | 'dir' }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const stat = await fs.stat(resolved);
    return {
      path: relativePath,
      exists: true,
      type: stat.isDirectory() ? 'dir' : 'file',
    };
  } catch {
    return { path: relativePath, exists: false };
  }
}

export async function fileDelete(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ path: string; deleted: boolean }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error('Only files can be deleted');
  }
  await fs.unlink(resolved);
  return { path: relativePath, deleted: true };
}

export async function appendFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; bytesAppended: number }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, content, 'utf-8');
  return { path: relativePath, bytesAppended: Buffer.byteLength(content, 'utf-8') };
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
