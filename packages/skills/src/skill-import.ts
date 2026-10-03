import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SkillDefinition } from '@anvio/core';
import type { SkillInstaller } from './skill-installer.js';

const execFileAsync = promisify(execFile);

const MAX_SCAN_DEPTH = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv']);

export interface SkillImportOptions {
  /** Sub-directory inside the source (e.g. `skills/research` in the Hermes repo). */
  subPath?: string;
  /** Override slug; only valid when the source resolves to a single skill. */
  slug?: string;
  /** Git ref (branch/tag) for git sources. */
  ref?: string;
  /** Injected for tests. */
  cloneImpl?: (url: string, dest: string, ref?: string) => Promise<void>;
}

export function isGitSource(source: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(source) || source.endsWith('.git');
}

async function gitClone(url: string, dest: string, ref?: string): Promise<void> {
  const args = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, dest];
  await execFileAsync('git', args, { timeout: 120_000 });
}

async function hasSkillMd(dir: string): Promise<boolean> {
  return fs.stat(path.join(dir, 'SKILL.md')).then((s) => s.isFile(), () => false);
}

/** Folders containing a SKILL.md: `root` itself, else every match up to MAX_SCAN_DEPTH below it. */
export async function findSkillDirs(root: string, depth = 0): Promise<string[]> {
  if (await hasSkillMd(root)) return [root];
  if (depth >= MAX_SCAN_DEPTH) return [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    found.push(...(await findSkillDirs(path.join(root, entry.name), depth + 1)));
  }
  return found.sort();
}

/**
 * Import agentskills.io / Hermes-style skill folders from a local path or git URL.
 * A source with a top-level SKILL.md imports one skill; otherwise every nested
 * skill folder is imported (e.g. a whole Hermes `skills/` category).
 */
export async function importSkills(
  installer: SkillInstaller,
  source: string,
  options: SkillImportOptions = {},
): Promise<SkillDefinition[]> {
  let tmp: string | null = null;
  try {
    let root = path.resolve(source);
    if (isGitSource(source)) {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skill-import-'));
      root = path.join(tmp, 'repo');
      await (options.cloneImpl ?? gitClone)(source, root, options.ref);
    }

    const base = options.subPath ? path.resolve(root, options.subPath) : root;
    if (path.relative(root, base).startsWith('..')) {
      throw new Error(`--path escapes the source: ${options.subPath}`);
    }

    const dirs = await findSkillDirs(base);
    if (dirs.length === 0) {
      throw new Error(`No SKILL.md found under ${options.subPath ?? source}`);
    }
    if (options.slug && dirs.length > 1) {
      throw new Error(`--name needs a single skill, but ${dirs.length} were found`);
    }

    const imported: SkillDefinition[] = [];
    for (const dir of dirs) {
      imported.push(await installer.installFromDir(dir, options.slug));
    }
    return imported;
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  }
}
