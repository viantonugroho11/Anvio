import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { patchFile } from './patch-file.js';
import { todoTool, clarifyTool } from './agent-session-tools.js';

describe('patch_file', () => {
  it('applies fuzzy line-trimmed patch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-patch-'));
    await fs.writeFile(path.join(tmp, 'a.ts'), '  const x = 1;\n  const y = 2;\n');
    const result = await patchFile(tmp, 'a.ts', 'const x = 1', 'const x = 42');
    expect(result.replacements).toBe(1);
    const content = await fs.readFile(path.join(tmp, 'a.ts'), 'utf-8');
    expect(content).toContain('const x = 42');
  });
});

describe('agent session tools', () => {
  it('todoTool merges items per session', () => {
    const first = todoTool('sess-1', { todos: [{ content: 'Plan', status: 'pending' }] });
    expect(first.todos).toHaveLength(1);
    const second = todoTool('sess-1', {
      merge: true,
      todos: [{ id: first.todos[0]!.id, content: 'Plan', status: 'completed' }],
    });
    expect(second.todos[0]?.status).toBe('completed');
  });

  it('clarifyTool returns structured question', () => {
    const out = clarifyTool({ question: 'Which API?', choices: ['REST', 'GraphQL'] });
    expect(out.choices).toEqual(['REST', 'GraphQL']);
  });
});
