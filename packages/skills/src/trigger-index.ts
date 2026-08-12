import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from '@anvio/core';
import { parseSkillDefinition } from '@anvio/core';
import type { SkillCatalogResolver } from './catalog-resolver.js';
import { matchTriggers, type TriggerMatchContext } from './trigger-matcher.js';

interface CacheEntry {
  slug: string;
  filePath: string;
  mtimeMs: number;
  skill: SkillDefinition;
}

/**
 * P1.S8 — skill-trigger index cache.
 *
 * Loads each skill YAML once, caches its parsed `SkillDefinition`, and re-parses
 * only when the file's mtime changes. `matchAll(message, ctx)` calls
 * `refresh()` first (which walks the two catalog directories, stats each entry,
 * and re-reads only stale ones) then runs the existing `matchTriggers` over the
 * cached array. Result: no per-message full catalog parse.
 *
 * Trade-offs
 * - The refresh step still `readdir`s both dirs each call, so it's O(N_files)
 *   stat calls per message rather than O(N_files) full YAML parses. For a
 *   typical 30–100 skill catalog this drops the per-message cost from tens of ms
 *   to sub-ms.
 * - New files added between refreshes are picked up on the next `matchAll`.
 * - Files renamed/deleted are dropped from the cache during refresh.
 * - The cache is process-local; multi-process workers each hold their own.
 */
export class SkillTriggerCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly paths: { bundledDir: string; workspaceDir: string }) {}

  static fromResolver(resolver: SkillCatalogResolver): SkillTriggerCache {
    const paths = (resolver as unknown as { paths: { bundledDir: string; workspaceDir: string } }).paths;
    return new SkillTriggerCache(paths);
  }

  async refresh(): Promise<void> {
    // workspace overrides bundled (workspace file wins for the same slug)
    const scanned = new Map<string, { filePath: string; mtimeMs: number }>();
    for (const dir of [this.paths.bundledDir, this.paths.workspaceDir]) {
      const files = await this.listYaml(dir);
      for (const filePath of files) {
        const slug = path.basename(filePath, path.extname(filePath));
        if (slug === 'manifest' || slug.startsWith('_')) continue;
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(filePath);
        } catch {
          continue;
        }
        scanned.set(slug, { filePath, mtimeMs: stat.mtimeMs });
      }
    }

    // drop cache entries no longer present
    for (const cachedSlug of [...this.entries.keys()]) {
      if (!scanned.has(cachedSlug)) this.entries.delete(cachedSlug);
    }

    // re-parse only changed / new files
    for (const [slug, meta] of scanned) {
      const existing = this.entries.get(slug);
      if (existing && existing.mtimeMs === meta.mtimeMs && existing.filePath === meta.filePath) {
        continue;
      }
      try {
        const raw = await fs.readFile(meta.filePath, 'utf-8');
        const skill = parseSkillDefinition(parseYaml(raw));
        this.entries.set(slug, { slug, filePath: meta.filePath, mtimeMs: meta.mtimeMs, skill });
      } catch {
        this.entries.delete(slug);
      }
    }
  }

  /** Cached skill list; call `refresh()` first if freshness matters. */
  currentSkills(): SkillDefinition[] {
    return [...this.entries.values()].map((e) => e.skill);
  }

  /** Refresh and match — returns slugs whose triggers match the message. */
  async matchAll(message: string, ctx: TriggerMatchContext = {}): Promise<string[]> {
    await this.refresh();
    return matchTriggers(message, this.currentSkills(), ctx);
  }

  /** Number of parsed skills currently cached — inspect for tests or metrics. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private async listYaml(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  }
}
