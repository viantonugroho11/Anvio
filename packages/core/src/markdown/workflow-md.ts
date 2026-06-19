import type { WorkflowDefinition } from '../schemas/workflow.schema.js';
import { parseWorkflowDefinition } from '../schemas/workflow.schema.js';
import { parseFrontmatter } from './frontmatter.js';

/** Workflow as markdown: YAML frontmatter holds the Workflow spec; body is human docs. */
export function parseWorkflowMd(source: string, slugFallback?: string): WorkflowDefinition {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(source);
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    throw new Error(`Workflow markdown missing frontmatter (${slugFallback ?? 'unknown'})`);
  }
  const doc =
    frontmatter.kind === 'Workflow'
      ? frontmatter
      : { apiVersion: 'anvio.io/v1', kind: 'Workflow', ...frontmatter };
  return parseWorkflowDefinition(doc);
}
