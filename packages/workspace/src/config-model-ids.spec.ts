import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_MODEL_IDS, RETIRED_ANTHROPIC_MODEL_IDS } from '@anvio/core';

/**
 * The sibling guard in `scaffold-model-ids.spec.ts` covers ids the scaffold
 * *generates*. This one covers ids the repo *ships* as config — YAML and Markdown
 * cannot import a constant, so `configs/agents/architect.yaml` and
 * `workspace/agents/architect.md` restate them as literals and nothing checked
 * them.
 *
 * That is exactly where the bug this whole guard family exists for would hide:
 * `claude-haiku-3-5-20241022` reversed the family and version segments of an
 * already-retired id, matched no model in any generation, and shipped on every
 * `anvio init` because no spec read the file it lived in.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Nearest ancestor holding `pnpm-workspace.yaml`. */
function repoRoot(): string {
  let dir = HERE;
  for (;;) {
    try {
      readFileSync(path.join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      // Reached the filesystem root without finding the marker.
      if (parent === dir) throw new Error(`no pnpm-workspace.yaml above ${HERE}`);
      dir = parent;
    }
  }
}

/**
 * Tracked config files only.
 *
 * `git ls-files` is the boundary rather than a hand-maintained exclude list:
 * `workspace/` also holds runtime data — sessions, credential stores, soul caches
 * — which is gitignored, machine-local, and free to name any model the operator
 * actually ran. Scanning it would fail this spec on a developer's machine for a
 * reason that is not a defect. What the repo commits is what the repo must stand
 * behind, and that is precisely what git tracks.
 *
 * `docs/` and `README.md` are deliberately out of scope. They carry illustrative
 * ids for providers this repo does not enumerate — `qwen/qwen-2.5-72b-instruct`,
 * `o3` — which are correct as prose and would be false positives here.
 *
 * Extensions are filtered in JS rather than passed as a pathspec: git pathspecs
 * are a union, not an intersection, so `ls-files configs -- '*.md'` returns every
 * tracked `.md` in the repo alongside everything under `configs/`.
 */
function trackedConfigFiles(): string[] {
  const root = repoRoot();
  const out = execFileSync('git', ['ls-files', '-z', '--', 'configs', 'workspace'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter((rel) => /\.(ya?ml|md)$/.test(rel))
    .map((rel) => path.join(root, rel));
}

/**
 * Every `model: <value>` scalar in a file.
 *
 * Matches only the scalar form, so the mapping key in
 * `model:\n  provider: anthropic\n  model: <id>` contributes the inner id and not
 * the outer key. Quotes are stripped because YAML permits them and an id is never
 * meaningfully quoted.
 */
function modelIdsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^\s*model:\s*["']?([^"'\s#]+)["']?\s*$/gm)].map((m) => m[1]!);
}

describe('model ids in shipped config', () => {
  const files = trackedConfigFiles();
  const found = files.flatMap((file) => modelIdsIn(file).map((id) => ({ file, id })));

  it('finds config to check', () => {
    // Without this the whole suite passes vacuously the day someone moves the
    // config, renames a directory, or changes the `model:` key — the failure mode
    // of every guard that greps for its own inputs.
    expect(files.length, 'no tracked config files matched').toBeGreaterThan(0);
    expect(found.length, `no "model:" values in ${files.length} files`).toBeGreaterThan(0);
  });

  it('names only ids the repo knows', () => {
    for (const { file, id } of found) {
      expect(KNOWN_MODEL_IDS.has(id), `unknown model id "${id}" in ${path.basename(file)}`).toBe(
        true,
      );
    }
  });

  it('names no retired Anthropic model', () => {
    for (const { file, id } of found) {
      expect(
        RETIRED_ANTHROPIC_MODEL_IDS.has(id),
        `retired model id "${id}" in ${path.basename(file)}`,
      ).toBe(false);
    }
  });
});
