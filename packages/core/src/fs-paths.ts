import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve `relativePath` against `root` and refuse anything that lands outside it.
 *
 * `resolved.startsWith(root)` — the check this replaces in four places — accepts
 * sibling directories that share a prefix (`/ws` admits `/ws-other/x`). Comparing
 * via `path.relative` does not (audit CQ-013).
 */
export function resolveInsideRoot(
  root: string,
  relativePath: string,
  message = 'Path escapes workspace',
): string {
  const base = path.resolve(root);
  const target = path.resolve(base, relativePath);
  if (!isInside(base, target)) throw new Error(message);
  return target;
}

/**
 * {@link resolveInsideRoot} plus a symlink check: the real path of the target (or of
 * its nearest existing ancestor, for paths about to be created) must also be inside
 * the real path of `root`. Use for paths chosen by a model or a remote caller.
 */
export async function resolveRealInsideRoot(
  root: string,
  relativePath: string,
  message = 'Path escapes workspace',
): Promise<string> {
  const target = resolveInsideRoot(root, relativePath, message);
  const realRoot = await realpathOrSelf(path.resolve(root));
  const realTarget = await realpathOfNearestExisting(target);
  if (!isInside(realRoot, realTarget)) throw new Error(message);
  return target;
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    // Root does not exist yet (first boot): its lexical path is the best answer.
    return p;
  }
}

async function realpathOfNearestExisting(p: string): Promise<string> {
  let current = p;
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return suffix.length ? path.join(real, ...suffix.reverse()) : real;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return p;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}
