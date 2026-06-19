import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BlueprintDefinition } from '@anvio/core';
import { parseBlueprintDefinition } from '@anvio/core';

export interface CatalogPaths {
  bundledDir: string;
  workspaceDir: string;
}

export class BlueprintCatalogRegistry {
  constructor(private readonly paths: CatalogPaths) {}

  async listBundled(): Promise<string[]> {
    return this.listDir(this.paths.bundledDir);
  }

  async listInstalled(): Promise<string[]> {
    return this.listDir(this.paths.workspaceDir);
  }

  async listAll(): Promise<Array<{ slug: string; source: 'bundled' | 'workspace' }>> {
    const bundled = (await this.listBundled()).map((slug) => ({
      slug,
      source: 'bundled' as const,
    }));
    const workspace = (await this.listInstalled()).map((slug) => ({
      slug,
      source: 'workspace' as const,
    }));
    const merged = new Map<string, { slug: string; source: 'bundled' | 'workspace' }>();
    for (const item of bundled) merged.set(item.slug, item);
    for (const item of workspace) merged.set(item.slug, item);
    return [...merged.values()];
  }

  async load(slug: string): Promise<BlueprintDefinition> {
    for (const dir of [this.paths.workspaceDir, this.paths.bundledDir]) {
      for (const ext of ['yaml', 'yml']) {
        const filePath = path.join(dir, `${slug}.${ext}`);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          return parseBlueprintDefinition(parseYaml(raw));
        } catch {
          // try next path
        }
      }
    }
    throw new Error(`Blueprint not found: ${slug}`);
  }

  async install(slug: string): Promise<BlueprintDefinition> {
    const blueprint = await this.loadFromBundled(slug);
    await fs.mkdir(this.paths.workspaceDir, { recursive: true });
    const dest = path.join(this.paths.workspaceDir, `${slug}.yaml`);
    await fs.writeFile(dest, await this.readBundledRaw(slug), 'utf-8');
    return blueprint;
  }

  async validateFile(filePath: string): Promise<BlueprintDefinition> {
    const raw = parseYaml(await fs.readFile(filePath, 'utf-8'));
    return parseBlueprintDefinition(raw);
  }

  private async loadFromBundled(slug: string): Promise<BlueprintDefinition> {
    const raw = parseYaml(await fs.readFile(await this.resolveBundledPath(slug), 'utf-8'));
    return parseBlueprintDefinition(raw);
  }

  private async readBundledRaw(slug: string): Promise<string> {
    return fs.readFile(await this.resolveBundledPath(slug), 'utf-8');
  }

  private async resolveBundledPath(slug: string): Promise<string> {
    for (const ext of ['yaml', 'yml']) {
      const filePath = path.join(this.paths.bundledDir, `${slug}.${ext}`);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // continue
      }
    }
    throw new Error(`Bundled blueprint not found: ${slug}`);
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

export function createCatalogRegistry(workspaceRoot: string, repoRoot?: string): BlueprintCatalogRegistry {
  const bundledDir = repoRoot
    ? path.join(repoRoot, 'configs/blueprints')
    : path.join(workspaceRoot, 'blueprints');
  return new BlueprintCatalogRegistry({
    bundledDir,
    workspaceDir: path.join(workspaceRoot, 'blueprints'),
  });
}
