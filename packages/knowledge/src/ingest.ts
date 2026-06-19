import fs from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeBaseStore } from './kb-store.js';

export interface IngestResult {
  slug: string;
  wikiFiles: string[];
  rawCount: number;
}

/** Synthesize wiki pages from raw/ markdown captures (filesystem-first; LLM synthesis deferred). */
export class KnowledgeIngestEngine {
  constructor(private readonly store: KnowledgeBaseStore) {}

  async ingest(slug: string): Promise<IngestResult> {
    await this.store.ensure(slug);
    const rawFiles = await this.store.listRaw(slug);
    const wikiFiles: string[] = [];

    for (const file of rawFiles) {
      const rawPath = path.join(this.store.rawDir(slug), file);
      const content = await fs.readFile(rawPath, 'utf-8');
      const wikiName = file.replace(/\.(md|txt)$/, '.wiki.md');
      const wikiPath = path.join(this.store.wikiDir(slug), wikiName);
      const wikiBody = `# ${file}\n\n_Synthesized from raw capture — ${new Date().toISOString()}_\n\n${content.trim()}\n`;
      await fs.writeFile(wikiPath, wikiBody, 'utf-8');
      wikiFiles.push(wikiName);
    }

    const manifest = await this.store.readManifest();
    const idx = manifest.spec.bases.findIndex((b) => b.slug === slug);
    const entry = {
      slug,
      rawFiles: rawFiles.length,
      wikiFiles: wikiFiles.length,
      syncedAt: new Date().toISOString(),
    };
    if (idx >= 0) manifest.spec.bases[idx] = entry;
    else manifest.spec.bases.push(entry);
    await this.store.writeManifest(manifest);

    return { slug, wikiFiles, rawCount: rawFiles.length };
  }

  async sync(slug: string): Promise<IngestResult> {
    return this.ingest(slug);
  }
}

export { KnowledgeBaseStore } from './kb-store.js';
