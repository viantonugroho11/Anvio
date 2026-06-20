import type { ModelToolDefinition } from '@anvio/core';
import { describeBuiltinTool } from './tool-descriptions.js';

const TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  web_fetch: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  web_search: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute_code: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      language: { type: 'string', enum: ['javascript', 'python', 'node', 'shell'] },
    },
    required: ['code'],
  },
  execute_code_pipeline: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            language: { type: 'string' },
          },
          required: ['code'],
        },
      },
    },
    required: ['steps'],
  },
  file_read: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  file_write: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  glob_files: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob e.g. **/*.ts' },
      maxResults: { type: 'number' },
    },
    required: ['pattern'],
  },
  grep_search: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      maxResults: { type: 'number' },
    },
    required: ['pattern'],
  },
  browser: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      action: { type: 'string', enum: ['navigate', 'screenshot', 'content'] },
      selector: { type: 'string' },
    },
    required: ['url'],
  },
  image_generate: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      size: { type: 'string' },
    },
    required: ['prompt'],
  },
  text_to_speech: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  memory_recall: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for long-term memory' },
      userId: { type: 'string', description: 'User scope (defaults to session user)' },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
};

export function buildModelToolDefinitions(toolNames: string[]): ModelToolDefinition[] {
  return toolNames
    .map((fullName) => {
      const key = fullName.replace(/^anvio_tools__/, '');
      const schema = TOOL_SCHEMAS[key];
      if (!schema) return undefined;
      return {
        name: fullName,
        description: describeBuiltinTool(fullName),
        inputSchema: schema,
      } satisfies ModelToolDefinition;
    })
    .filter((t): t is ModelToolDefinition => t != null);
}

export { TOOL_SCHEMAS };
