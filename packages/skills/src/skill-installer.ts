import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SkillDefinition } from '@anvio/core';
import type { SkillCatalogResolver } from './catalog-resolver.js';

export interface InstalledSkillManifest {
  apiVersion: 'anvio.io/v1';
  kind: 'SkillManifest';
  spec: {
    installed: Array<{ slug: string; version: string; source: 'bundled' | 'url'; installedAt: string }>;
  };
}

export class SkillInstaller {
  constructor(
    private readonly catalog: SkillCatalogResolver,
    private readonly workspaceSkillsDir: string,
  ) {}

  private manifestPath(): string {
    return path.join(this.workspaceSkillsDir, '_installed/manifest.yaml');
  }

  async install(slug: string): Promise<SkillDefinition> {
    const raw = await this.catalog.readBundledRaw(slug);
    if (!raw) {
      throw new Error(`Skill ${slug} is not available in bundled catalog`);
    }

    const skill = (await this.catalog.load(slug));
    await fs.mkdir(this.workspaceSkillsDir, { recursive: true });
    await fs.writeFile(path.join(this.workspaceSkillsDir, `${slug}.yaml`), raw, 'utf-8');
    await this.recordInstall(skill, 'bundled');
    return skill;
  }

  async listInstalled(): Promise<InstalledSkillManifest['spec']['installed']> {
    const manifest = await this.readManifest();
    return manifest.spec.installed;
  }

  async remove(slug: string): Promise<void> {
    await fs.rm(path.join(this.workspaceSkillsDir, `${slug}.yaml`), { force: true });
    const manifest = await this.readManifest();
    manifest.spec.installed = manifest.spec.installed.filter((s) => s.slug !== slug);
    await this.writeManifest(manifest);
  }

  private async recordInstall(skill: SkillDefinition, source: 'bundled' | 'url'): Promise<void> {
    const manifest = await this.readManifest();
    const entry = {
      slug: skill.metadata.slug,
      version: skill.metadata.version,
      source,
      installedAt: new Date().toISOString(),
    };
    const idx = manifest.spec.installed.findIndex((s) => s.slug === skill.metadata.slug);
    if (idx >= 0) manifest.spec.installed[idx] = entry;
    else manifest.spec.installed.push(entry);
    await this.writeManifest(manifest);
  }

  private async readManifest(): Promise<InstalledSkillManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath(), 'utf-8');
      return parseYaml(raw) as InstalledSkillManifest;
    } catch {
      return { apiVersion: 'anvio.io/v1', kind: 'SkillManifest', spec: { installed: [] } };
    }
  }

  private async writeManifest(manifest: InstalledSkillManifest): Promise<void> {
    await fs.mkdir(path.dirname(this.manifestPath()), { recursive: true });
    await fs.writeFile(this.manifestPath(), stringifyYaml(manifest), 'utf-8');
  }
}

export function createSkillInstaller(catalog: SkillCatalogResolver, workspacePath: string): SkillInstaller {
  return new SkillInstaller(catalog, path.join(workspacePath, 'skills'));
}
