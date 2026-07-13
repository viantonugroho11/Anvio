import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { KnowledgeBaseStore } from './kb-store.js';

export interface IngestResult {
  slug: string;
  wikiFiles: string[];
  rawCount: number;
  /** Raw files skipped because their content hash was unchanged since last sync. */
  skipped: number;
}

/** Synthesize wiki pages from raw/ markdown captures (filesystem-first; LLM synthesis deferred). */
export class KnowledgeIngestEngine {
  constructor(private readonly store: KnowledgeBaseStore) {}

  async ingest(slug: string): Promise<IngestResult> {
    await this.store.ensure(slug);
    const rawFiles = await this.store.listRaw(slug);
    const wikiFiles: string[] = [];

    const manifest = await this.store.readManifest();
    const idx = manifest.spec.bases.findIndex((b) => b.slug === slug);
    const previousHashes = (idx >= 0 ? manifest.spec.bases[idx].fileHashes : undefined) ?? {};
    const fileHashes: Record<string, string> = {};
    let skipped = 0;

    for (const file of rawFiles) {
      const rawPath = path.join(this.store.rawDir(slug), file);
      const content = await fs.readFile(rawPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      fileHashes[file] = hash;

      const wikiName = file.replace(/\.(md|txt)$/, '.wiki.md');
      const wikiPath = path.join(this.store.wikiDir(slug), wikiName);
      wikiFiles.push(wikiName);

      // Incremental sync: unchanged content with an existing wiki page skips re-ingest.
      if (previousHashes[file] === hash && (await fileExists(wikiPath))) {
        skipped += 1;
        continue;
      }

      const wikiBody = `# ${file}\n\n_Synthesized from raw capture — ${new Date().toISOString()}_\n\n${content.trim()}\n`;
      await fs.writeFile(wikiPath, wikiBody, 'utf-8');
    }

    const entry = {
      slug,
      rawFiles: rawFiles.length,
      wikiFiles: wikiFiles.length,
      syncedAt: new Date().toISOString(),
      fileHashes,
    };
    if (idx >= 0) manifest.spec.bases[idx] = entry;
    else manifest.spec.bases.push(entry);
    await this.store.writeManifest(manifest);

    return { slug, wikiFiles, rawCount: rawFiles.length, skipped };
  }

  async sync(slug: string): Promise<IngestResult> {
    return this.ingest(slug);
  }
}


async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export { KnowledgeBaseStore } from './kb-store.js';
