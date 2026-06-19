import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorktreeInfo, WorktreeManager } from '@anvio/core';

const exec = promisify(execFile);

export interface GitWorktreeManagerOptions {
  workspaceRoot: string;
  repoPath: string;
  worktreesDir?: string;
}

export class GitWorktreeManager implements WorktreeManager {
  private readonly worktreesRoot: string;
  private readonly repoRoot: string;

  constructor(options: GitWorktreeManagerOptions) {
    this.worktreesRoot = path.resolve(
      options.workspaceRoot,
      options.worktreesDir ?? 'worktrees',
    );
    this.repoRoot = path.resolve(options.workspaceRoot, options.repoPath);
  }

  private manifestKey(sessionId: string): string {
    return path.join(this.worktreesRoot, sessionId, '.anvio-worktree.json');
  }

  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await exec('git', ['rev-parse', '--git-dir'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }

  async create(sessionId: string): Promise<WorktreeInfo> {
    const existing = await this.get(sessionId);
    if (existing) return existing;

    if (!(await this.isGitRepo(this.repoRoot))) {
      throw new Error(`Not a git repository: ${this.repoRoot}`);
    }

    const wtPath = path.join(this.worktreesRoot, sessionId);
    const branch = `anvio/agent-${sessionId.slice(0, 8)}`;

    await fs.mkdir(this.worktreesRoot, { recursive: true });
    await exec('git', ['worktree', 'add', '-B', branch, wtPath], { cwd: this.repoRoot });

    const info: WorktreeInfo = {
      sessionId,
      path: wtPath,
      branch,
      repoPath: this.repoRoot,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(this.manifestKey(sessionId), JSON.stringify(info, null, 2), 'utf-8');
    return info;
  }

  async get(sessionId: string): Promise<WorktreeInfo | null> {
    try {
      const raw = await fs.readFile(this.manifestKey(sessionId), 'utf-8');
      return JSON.parse(raw) as WorktreeInfo;
    } catch {
      return null;
    }
  }

  async remove(sessionId: string): Promise<void> {
    const info = await this.get(sessionId);
    if (!info) return;

    try {
      await exec('git', ['worktree', 'remove', '--force', info.path], { cwd: this.repoRoot });
    } catch {
      await fs.rm(info.path, { recursive: true, force: true });
    }

    try {
      await exec('git', ['branch', '-D', info.branch], { cwd: this.repoRoot });
    } catch {
      /* branch may already be gone */
    }

    await fs.rm(path.join(this.worktreesRoot, sessionId), { recursive: true, force: true });
  }

  async list(): Promise<WorktreeInfo[]> {
    try {
      const entries = await fs.readdir(this.worktreesRoot, { withFileTypes: true });
      const results: WorktreeInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const info = await this.get(entry.name);
        if (info) results.push(info);
      }
      return results;
    } catch {
      return [];
    }
  }
}

export function createWorktreeManager(
  workspaceRoot: string,
  config?: { enabled?: boolean; repoPath?: string },
): WorktreeManager | null {
  if (!config?.enabled) return null;
  return new GitWorktreeManager({
    workspaceRoot,
    repoPath: config.repoPath ?? '..',
  });
}
