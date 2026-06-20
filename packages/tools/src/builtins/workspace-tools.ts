import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodeExecutor } from '@anvio/core';
import { executeCodeWithExecutor } from './filesystem.js';

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

async function walkFiles(
  dir: string,
  relativePrefix: string,
  files: string[],
  maxResults: number,
): Promise<void> {
  if (files.length >= maxResults) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxResults) break;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const rel = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, rel, files, maxResults);
    } else if (entry.isFile()) {
      files.push(rel.replace(/\\/g, '/'));
    }
  }
}

export async function globFiles(
  workspaceRoot: string,
  pattern: string,
  maxResults = 50,
): Promise<{ pattern: string; files: string[] }> {
  const all: string[] = [];
  await walkFiles(workspaceRoot, '', all, maxResults * 4);
  const re = globToRegExp(pattern.replace(/\\/g, '/'));
  const files = all.filter((file) => re.test(file)).slice(0, maxResults);
  return { pattern, files };
}

export async function grepSearch(
  workspaceRoot: string,
  pattern: string,
  searchPath = '.',
  maxResults = 30,
): Promise<{ pattern: string; matches: Array<{ file: string; line: number; text: string }> }> {
  const re = new RegExp(pattern, 'i');
  const root = path.resolve(workspaceRoot, searchPath);
  if (!root.startsWith(path.resolve(workspaceRoot))) {
    throw new Error('Path escapes workspace');
  }
  const relFiles: string[] = [];
  await walkFiles(root, '', relFiles, 500);
  const extRe = /\.(ts|tsx|js|md|yml|yaml|json)$/;
  const files = relFiles.filter((file) => extRe.test(file));
  const matches: Array<{ file: string; line: number; text: string }> = [];
  const filePrefix = searchPath === '.' ? '' : `${searchPath.replace(/\\/g, '/')}/`;
  for (const file of files) {
    if (matches.length >= maxResults) break;
    const full = path.join(root, file);
    const content = await fs.readFile(full, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      if (re.test(lines[i] ?? '')) {
        matches.push({
          file: `${filePrefix}${file}`.replace(/^\//, ''),
          line: i + 1,
          text: (lines[i] ?? '').trim().slice(0, 200),
        });
      }
    }
  }
  return { pattern, matches };
}

export interface CodePipelineStep {
  code: string;
  language?: string;
}

export async function executeCodePipeline(
  executor: CodeExecutor,
  steps: CodePipelineStep[],
): Promise<{ steps: Array<{ index: number; stdout: string; stderr: string; exitCode: number }> }> {
  const results: Array<{ index: number; stdout: string; stderr: string; exitCode: number }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const out = await executeCodeWithExecutor(executor, step.code, step.language ?? 'javascript');
    results.push({ index: i, ...out });
    if (out.exitCode !== 0) break;
  }
  return { steps: results };
}
