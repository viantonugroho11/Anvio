import { globFiles, grepSearch } from './workspace-tools.js';

/** Hermes search_files — content regex search or filename glob. */
export async function searchFiles(
  workspaceRoot: string,
  pattern: string,
  target: 'content' | 'name' = 'content',
  searchPath = '.',
  maxResults = 30,
): Promise<{ pattern: string; target: string; files?: string[]; matches?: Array<{ file: string; line: number; text: string }> }> {
  if (target === 'name') {
    const glob = await globFiles(workspaceRoot, pattern, maxResults);
    return { pattern, target, files: glob.files };
  }
  const grep = await grepSearch(workspaceRoot, pattern, searchPath, maxResults);
  return { pattern, target, matches: grep.matches };
}
