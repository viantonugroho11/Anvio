import fs from 'node:fs/promises';
import path from 'node:path';
import { parseKnowledgeManifest, type KnowledgeManifest } from '@anvio/core';

export class KnowledgeBaseStore {
  constructor(private readonly rootDir: string) {}

  baseDir(slug: string): string {
    return path.join(this.rootDir, 'knowledge', slug);
  }

  rawDir(slug: string): string {
    return path.join(this.baseDir(slug), 'raw');
  }

  wikiDir(slug: string): string {
    return path.join(this.baseDir(slug), 'wiki');
  }

  async ensure(slug: string): Promise<void> {
    await fs.mkdir(this.rawDir(slug), { recursive: true });
    await fs.mkdir(this.wikiDir(slug), { recursive: true });
  }

  async listRaw(slug: string): Promise<string[]> {
    try {
      return (await fs.readdir(this.rawDir(slug))).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    } catch {
      return [];
    }
  }

  async appendRaw(slug: string, filename: string, content: string): Promise<string> {
    await this.ensure(slug);
    const filePath = path.join(this.rawDir(slug), filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  manifestPath(): string {
    return path.join(this.rootDir, 'knowledge', '_manifest.yaml');
  }

  async readManifest(): Promise<KnowledgeManifest> {
    try {
      const { parse: parseYaml } = await import('yaml');
      const raw = parseYaml(await fs.readFile(this.manifestPath(), 'utf-8'));
      return parseKnowledgeManifest(raw);
    } catch {
      return { apiVersion: 'anvio.io/v1', kind: 'KnowledgeManifest', spec: { bases: [] } };
    }
  }

  async writeManifest(manifest: KnowledgeManifest): Promise<void> {
    const { stringify: stringifyYaml } = await import('yaml');
    await fs.mkdir(path.join(this.rootDir, 'knowledge'), { recursive: true });
    await fs.writeFile(this.manifestPath(), stringifyYaml(manifest), 'utf-8');
  }

  async listBases(): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(this.rootDir, 'knowledge'), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
    } catch {
      return [];
    }
  }
}
