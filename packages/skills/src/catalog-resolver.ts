import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from '@anvio/core';
import { parseSkillDefinition } from '@anvio/core';

export interface SkillCatalogPaths {
  bundledDir: string;
  workspaceDir: string;
}

export class SkillCatalogResolver {
  constructor(private readonly paths: SkillCatalogPaths) {}

  async listBundled(): Promise<string[]> {
    return this.listDir(this.paths.bundledDir);
  }

  async listWorkspace(): Promise<string[]> {
    return this.listDir(this.paths.workspaceDir);
  }

  async listAll(): Promise<Array<{ slug: string; source: 'bundled' | 'workspace' }>> {
    const bundled = (await this.listBundled()).map((slug) => ({ slug, source: 'bundled' as const }));
    const workspace = (await this.listWorkspace()).map((slug) => ({ slug, source: 'workspace' as const }));
    const merged = new Map<string, { slug: string; source: 'bundled' | 'workspace' }>();
    for (const item of bundled) merged.set(item.slug, item);
    for (const item of workspace) merged.set(item.slug, item);
    return [...merged.values()];
  }

  async load(slug: string): Promise<SkillDefinition> {
    for (const dir of [this.paths.workspaceDir, this.paths.bundledDir]) {
      for (const ext of ['yaml', 'yml']) {
        const filePath = path.join(dir, `${slug}.${ext}`);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          return parseSkillDefinition(parseYaml(raw));
        } catch {
          // try next
        }
      }
    }
    throw new Error(`Skill not found: ${slug}`);
  }

  async readBundledRaw(slug: string): Promise<string | null> {
    for (const ext of ['yaml', 'yml']) {
      const filePath = path.join(this.paths.bundledDir, `${slug}.${ext}`);
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {
        // try next
      }
    }
    return null;
  }

  private async listDir(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => path.basename(f, path.extname(f)))
        .filter((slug) => slug !== 'manifest' && !slug.startsWith('_'));
    } catch {
      return [];
    }
  }
}

export function createSkillCatalogResolver(workspacePath: string, repoRoot?: string): SkillCatalogResolver {
  const bundledDir = repoRoot
    ? path.join(repoRoot, 'configs/skills')
    : path.join(workspacePath, 'skills');
  return new SkillCatalogResolver({
    bundledDir,
    workspaceDir: path.join(workspacePath, 'skills'),
  });
}
