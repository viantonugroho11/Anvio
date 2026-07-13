import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeBaseStore } from './kb-store.js';
import { KnowledgeIngestEngine } from './ingest.js';

describe('KnowledgeIngestEngine incremental sync (EVO-012)', () => {
  it('skips unchanged files on re-sync and re-ingests changed ones', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-kb-'));
    const store = new KnowledgeBaseStore(tmp);
    const engine = new KnowledgeIngestEngine(store);

    await store.appendRaw('docs', 'a.md', 'alpha content');
    await store.appendRaw('docs', 'b.md', 'beta content');

    const first = await engine.ingest('docs');
    expect(first.skipped).toBe(0);
    expect(first.wikiFiles).toHaveLength(2);

    // unchanged corpus: everything skips
    const second = await engine.ingest('docs');
    expect(second.skipped).toBe(2);

    // change one file: only that one re-ingests
    await store.appendRaw('docs', 'a.md', 'alpha content v2');
    const third = await engine.ingest('docs');
    expect(third.skipped).toBe(1);

    const wiki = await fs.readFile(path.join(store.wikiDir('docs'), 'a.wiki.md'), 'utf-8');
    expect(wiki).toContain('alpha content v2');

    const manifest = await store.readManifest();
    expect(manifest.spec.bases[0].fileHashes).toBeDefined();
    expect(Object.keys(manifest.spec.bases[0].fileHashes!)).toHaveLength(2);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
