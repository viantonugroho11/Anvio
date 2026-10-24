import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from '@anvio/core';
import { parseSkillDefinition, resolveInsideRoot } from '@anvio/core';

/** No executable (YAML) definition exists for the slug — normal for prose-only skills. */
export class SkillNotFoundError extends Error {
  constructor(readonly slug: string) {
    super(`Skill not found: ${slug}`);
    this.name = 'SkillNotFoundError';
  }
}

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

  /**
   * Load a skill definition by slug, workspace first. A file that exists but does
   * not parse is an error naming the file; it used to be reported as "not found",
   * hiding the typo. Slugs can come from model tool calls (`skill_view`,
   * `skill_call`), so they are kept inside the catalog directories.
   */
  async load(slug: string): Promise<SkillDefinition> {
    for (const dir of [this.paths.workspaceDir, this.paths.bundledDir]) {
      for (const ext of ['yaml', 'yml']) {
        const filePath = resolveInsideRoot(dir, `${slug}.${ext}`, `Invalid skill slug: ${slug}`);
        let raw: string;
        try {
          raw = await fs.readFile(filePath, 'utf-8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        try {
          return parseSkillDefinition(parseYaml(raw));
        } catch (error) {
          throw new Error(
            `Invalid skill definition ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
    }
    throw new SkillNotFoundError(slug);
  }

  async readBundledRaw(slug: string): Promise<string | null> {
    for (const ext of ['yaml', 'yml']) {
      const filePath = resolveInsideRoot(this.paths.bundledDir, `${slug}.${ext}`, `Invalid skill slug: ${slug}`);
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
