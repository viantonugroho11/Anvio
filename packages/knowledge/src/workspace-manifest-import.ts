import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { KnowledgeBaseStore } from './kb-store.js';
import { KnowledgeIngestEngine } from './ingest.js';

export const workspaceManifestSchema = z.object({
  version: z.string().optional(),
  name: z.string().optional(),
  knowledge: z
    .array(
      z.object({
        slug: z.string(),
        rawDir: z.string().default('raw'),
        description: z.string().optional(),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        source: z.string(),
        slug: z.string().optional(),
      }),
    )
    .default([]),
});

export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export interface WorkspaceManifestImportResult {
  knowledgeBases: Array<{ slug: string; filesCopied: number; ingested: boolean }>;
  skills: Array<{ slug: string; path: string }>;
}

export class WorkspaceManifestImporter {
  constructor(
    private readonly workspaceRoot: string,
    private readonly store = new KnowledgeBaseStore(workspaceRoot),
    private readonly ingest = new KnowledgeIngestEngine(new KnowledgeBaseStore(workspaceRoot)),
  ) {}

  async importFromFile(manifestPath: string): Promise<WorkspaceManifestImportResult> {
    const abs = path.resolve(manifestPath);
    const root = path.dirname(abs);
    const raw = JSON.parse(await fs.readFile(abs, 'utf-8')) as unknown;
    const manifest = workspaceManifestSchema.parse(raw);
    return this.importManifest(manifest, root);
  }

  async importManifest(
    manifest: WorkspaceManifest,
    projectRoot: string,
  ): Promise<WorkspaceManifestImportResult> {
    const result: WorkspaceManifestImportResult = { knowledgeBases: [], skills: [] };

    for (const kb of manifest.knowledge) {
      const srcDir = path.resolve(projectRoot, kb.rawDir);
      await this.store.ensure(kb.slug);
      let filesCopied = 0;
      try {
        const files = await fs.readdir(srcDir);
        for (const file of files) {
          if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
          const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
          await this.store.appendRaw(kb.slug, file, content);
          filesCopied += 1;
        }
      } catch {
        // empty or missing dir
      }
      let ingested = false;
      if (filesCopied > 0) {
        await this.ingest.ingest(kb.slug);
        ingested = true;
      }
      result.knowledgeBases.push({ slug: kb.slug, filesCopied, ingested });
    }

    for (const skill of manifest.skills) {
      const src = path.resolve(projectRoot, skill.source);
      const base = skill.slug ?? path.basename(skill.source, path.extname(skill.source));
      const destDir = path.join(this.workspaceRoot, 'skills');
      await fs.mkdir(destDir, { recursive: true });
      const dest = path.join(destDir, `${base}.md`);
      await fs.copyFile(src, dest);
      result.skills.push({ slug: base, path: dest });
    }

    const manifestFile = await this.store.readManifest();
    for (const kb of result.knowledgeBases) {
      const existing = manifestFile.spec.bases.find((b) => b.slug === kb.slug);
      if (existing) {
        existing.syncedAt = new Date().toISOString();
      } else {
        manifestFile.spec.bases.push({
          slug: kb.slug,
          rawFiles: kb.filesCopied,
          wikiFiles: kb.ingested ? 1 : 0,
          syncedAt: new Date().toISOString(),
        });
      }
    }
    await this.store.writeManifest(manifestFile);

    return result;
  }
}
