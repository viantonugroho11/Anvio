import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { WorkflowDefinition } from '@anvio/core';
import { parseWorkflowDefinition } from '@anvio/core';

export interface WorkflowRegistryPaths {
  bundledDir: string;
  workspaceDir: string;
}

export class WorkflowRegistry {
  constructor(private readonly paths: WorkflowRegistryPaths) {}

  async listAll(): Promise<Array<{ slug: string; source: 'bundled' | 'workspace' }>> {
    const bundled = (await this.listDir(this.paths.bundledDir)).map((slug) => ({
      slug,
      source: 'bundled' as const,
    }));
    const workspace = (await this.listDir(this.paths.workspaceDir)).map((slug) => ({
      slug,
      source: 'workspace' as const,
    }));
    const merged = new Map<string, { slug: string; source: 'bundled' | 'workspace' }>();
    for (const item of bundled) merged.set(item.slug, item);
    for (const item of workspace) merged.set(item.slug, item);
    return [...merged.values()];
  }

  async load(slug: string): Promise<WorkflowDefinition> {
    for (const dir of [this.paths.workspaceDir, this.paths.bundledDir]) {
      for (const ext of ['yaml', 'yml']) {
        const filePath = path.join(dir, `${slug}.${ext}`);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          return parseWorkflowDefinition(parseYaml(raw));
        } catch {
          // try next path
        }
      }
    }
    throw new Error(`Workflow not found: ${slug}`);
  }

  async validateFile(filePath: string): Promise<WorkflowDefinition> {
    const raw = parseYaml(await fs.readFile(filePath, 'utf-8'));
    return parseWorkflowDefinition(raw);
  }

  private async listDir(dir: string): Promise<string[]> {
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => f.replace(/\.(yaml|yml)$/, ''))
        .filter((f) => !f.startsWith('_'));
    } catch {
      return [];
    }
  }
}

export function createWorkflowRegistry(workspaceRoot: string, repoRoot?: string): WorkflowRegistry {
  const bundledDir = repoRoot
    ? path.join(repoRoot, 'configs/workflows')
    : path.join(workspaceRoot, 'workflows');
  return new WorkflowRegistry({
    bundledDir,
    workspaceDir: path.join(workspaceRoot, 'workflows'),
  });
}
