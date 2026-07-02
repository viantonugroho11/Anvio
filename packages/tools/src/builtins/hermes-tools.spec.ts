import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { patchFile } from './patch-file.js';
import { todoTool, clarifyTool } from './agent-session-tools.js';
import { kanbanCommentTask, kanbanCompleteTask } from './kanban-tools.js';
import { skillsListTool } from './orchestration-tools.js';
import { xSearch, rlTool, videoAnalyze, videoGenerate } from './niche-tools.js';
import { haListEntities } from './homeassistant-tools.js';
import type { KanbanStore } from '@anvio/core';

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

describe('kanban extended tools', () => {
  it('kanbanCommentTask appends comment to description', async () => {
    const kanban: KanbanStore = {
      listBoards: async () => [],
      getBoard: async () => null,
      listTasks: async () => [],
      getTask: async (id) => ({
        apiVersion: 'anvio.io/v1',
        kind: 'KanbanTask',
        metadata: { id, createdAt: '', updatedAt: '' },
        spec: {
          title: 'T',
          description: 'base',
          column: 'todo',
          priority: 'medium',
          assignees: [],
          requiredSkills: [],
          labels: [],
          board: 'default',
        },
      }),
      createTask: async () => {
        throw new Error('not used');
      },
      moveTask: async () => {
        throw new Error('not used');
      },
      assignAgent: async () => {
        throw new Error('not used');
      },
      updateAgentState: async () => {
        throw new Error('not used');
      },
      updateTask: async (_id, patch) => ({
        apiVersion: 'anvio.io/v1',
        kind: 'KanbanTask',
        metadata: { id: 'task-1', updatedAt: new Date().toISOString() },
        spec: {
          title: 'T',
          description: patch.appendDescription ? `base\n\n${patch.appendDescription}` : 'base',
          column: 'todo',
          priority: 'medium',
          assignees: [],
          requiredSkills: [],
          labels: [],
          board: 'default',
        },
      }),
      listLanes: async () => [],
    };
    const out = await kanbanCommentTask(kanban, 'task-1', 'Ship it');
    expect((out.task as { spec: { description: string } }).spec.description).toContain('Ship it');
  });

  it('kanbanCompleteTask moves to done', async () => {
    const kanban: KanbanStore = {
      listBoards: async () => [],
      getBoard: async () => null,
      listTasks: async () => [],
      getTask: async () => null,
      createTask: async () => {
        throw new Error('not used');
      },
      moveTask: async (_id, column) => ({
        apiVersion: 'anvio.io/v1',
        kind: 'KanbanTask',
        metadata: { id: 'task-1' },
        spec: {
          title: 'T',
          description: '',
          column,
          priority: 'medium',
          assignees: [],
          requiredSkills: [],
          labels: [],
          board: 'default',
        },
      }),
      assignAgent: async () => {
        throw new Error('not used');
      },
      updateAgentState: async () => {
        throw new Error('not used');
      },
      updateTask: async () => {
        throw new Error('not used');
      },
      listLanes: async () => [],
    };
    const out = await kanbanCompleteTask(kanban, 'task-1');
    expect((out.task as { spec: { column: string } }).spec.column).toBe('done');
  });
});

describe('orchestration tools', () => {
  it('skillsListTool requires handler', async () => {
    await expect(skillsListTool(undefined)).rejects.toThrow('listSkills');
  });
});

describe('P11d niche tools', () => {
  it('xSearch returns note without API keys', async () => {
    const prev = process.env.X_BEARER_TOKEN;
    const prevWeb = process.env.WEB_SEARCH_API_KEY;
    delete process.env.X_BEARER_TOKEN;
    delete process.env.WEB_SEARCH_API_KEY;
    const result = await xSearch('anvio agent');
    expect(result.status).toBe('completed');
    expect(result.output).toMatchObject({ note: expect.any(String) });
    if (prev) process.env.X_BEARER_TOKEN = prev;
    if (prevWeb) process.env.WEB_SEARCH_API_KEY = prevWeb;
  });

  it('haListEntities fails without HA config', async () => {
    const prevUrl = process.env.HOME_ASSISTANT_URL;
    const prevToken = process.env.HOME_ASSISTANT_TOKEN;
    delete process.env.HOME_ASSISTANT_URL;
    delete process.env.HA_URL;
    delete process.env.HOME_ASSISTANT_TOKEN;
    delete process.env.HA_TOKEN;
    const result = await haListEntities();
    expect(result.status).toBe('failed');
    if (prevUrl) process.env.HOME_ASSISTANT_URL = prevUrl;
    if (prevToken) process.env.HOME_ASSISTANT_TOKEN = prevToken;
  });

  it('rlTool returns MCP setup note when no MCP/API/mock configured', async () => {
    delete process.env.ANVIO_ATROPOS_MOCK;
    delete process.env.ATROPOS_API_URL;
    const result = await rlTool('list_environments');
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result.output)).toContain('Tinker-Atropos');
  });

  it('rlTool runs a live-shaped mock training loop when ANVIO_ATROPOS_MOCK=1', async () => {
    process.env.ANVIO_ATROPOS_MOCK = '1';
    try {
      const started = await rlTool('start_training', { environment: 'demo' });
      expect(started.status).toBe('completed');
      const startedOutput = started.output as { jobId: string; status: string };
      expect(startedOutput.jobId).toMatch(/^mock-rl-/);

      const status = await rlTool('check_status', { jobId: startedOutput.jobId });
      expect(status.status).toBe('completed');
      expect((status.output as { status: string }).status).toBe('running');
    } finally {
      delete process.env.ANVIO_ATROPOS_MOCK;
    }
  });

  it('videoAnalyze returns mock analysis when ANVIO_VIDEO_MOCK=1', async () => {
    process.env.ANVIO_VIDEO_MOCK = '1';
    try {
      const result = await videoAnalyze('https://example.com/clip.mp4');
      expect(result.status).toBe('completed');
      expect((result.output as { mock: boolean }).mock).toBe(true);
    } finally {
      delete process.env.ANVIO_VIDEO_MOCK;
    }
  });

  it('videoGenerate returns mock video url when ANVIO_VIDEO_MOCK=1', async () => {
    process.env.ANVIO_VIDEO_MOCK = '1';
    try {
      const result = await videoGenerate('a cat riding a bike');
      expect(result.status).toBe('completed');
      expect((result.output as { videoUrl: string }).videoUrl).toContain('mock://');
    } finally {
      delete process.env.ANVIO_VIDEO_MOCK;
    }
  });

  it('videoGenerate returns MCP setup note when unconfigured', async () => {
    delete process.env.ANVIO_VIDEO_MOCK;
    const result = await videoGenerate('a cat riding a bike');
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result.output)).toContain('video-gen');
  });
});
