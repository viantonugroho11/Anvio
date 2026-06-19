import { parse as parseYaml } from 'yaml';

export interface ParsedMarkdownDocument<T = Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

/** Split optional YAML frontmatter from markdown body (Hermes / agentskills.io style). */
export function parseFrontmatter<T = Record<string, unknown>>(source: string): ParsedMarkdownDocument<T> {
  const trimmed = source.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {} as T, body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {} as T, body: trimmed };
  }
  const yamlBlock = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trimStart();
  const frontmatter = yamlBlock ? (parseYaml(yamlBlock) as T) : ({} as T);
  return { frontmatter, body };
}
