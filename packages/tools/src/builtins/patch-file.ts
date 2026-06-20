import fs from 'node:fs/promises';
import path from 'node:path';

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(path.resolve(workspaceRoot))) {
    throw new Error('Path escapes workspace');
  }
  return resolved;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function tryReplace(content: string, oldString: string, newString: string): string | null {
  if (content.includes(oldString)) {
    return content.replace(oldString, newString);
  }
  const lineTrimmed = oldString
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
  const contentLines = content.split('\n');
  const oldLines = lineTrimmed.split('\n');
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j]?.trim() !== oldLines[j]?.trim()) {
        match = false;
        break;
      }
    }
    if (match) {
      const before = contentLines.slice(0, i);
      const after = contentLines.slice(i + oldLines.length);
      return [...before, ...newString.split('\n'), ...after].join('\n');
    }
  }
  const normOld = normalizeWhitespace(oldString);
  const normContent = normalizeWhitespace(content);
  if (normContent.includes(normOld)) {
    const start = content.indexOf(oldString);
    if (start >= 0) {
      return content.slice(0, start) + newString + content.slice(start + oldString.length);
    }
  }
  return null;
}

/** Hermes-style patch — fuzzy find-replace with unified diff summary. */
export async function patchFile(
  workspaceRoot: string,
  relativePath: string,
  oldString: string,
  newString: string,
): Promise<{ path: string; replacements: number; bytes: number; diff: string }> {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const before = await fs.readFile(resolved, 'utf-8');
  const updated = tryReplace(before, oldString, newString);
  if (updated == null) {
    throw new Error('old_string not found in file (fuzzy match failed)');
  }
  await fs.writeFile(resolved, updated, 'utf-8');
  const diff = buildSimpleDiff(before, updated, relativePath);
  return {
    path: relativePath,
    replacements: 1,
    bytes: Buffer.byteLength(updated, 'utf-8'),
    diff,
  };
}

function buildSimpleDiff(before: string, after: string, path: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) {
      if (a != null) lines.push(` ${a}`);
    } else {
      if (a != null) lines.push(`-${a}`);
      if (b != null) lines.push(`+${b}`);
    }
  }
  return lines.slice(0, 80).join('\n');
}
