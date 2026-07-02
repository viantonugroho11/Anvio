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
  list_dir: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Relative directory path (default ".")' } },
  },
  edit_file: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  run_shell: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
  http_request: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      method: { type: 'string' },
      headers: { type: 'object' },
      body: { type: 'string' },
      timeoutMs: { type: 'number' },
    },
    required: ['url'],
  },
  path_exists: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  file_delete: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  append_file: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  json_parse: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  datetime_now: {
    type: 'object',
    properties: { timezone: { type: 'string', description: 'IANA timezone e.g. UTC, Asia/Jakarta' } },
  },
  web_extract: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  patch_file: {
    type: 'object',
    properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
    required: ['path', 'old_string', 'new_string'],
  },
  search_files: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      target: { type: 'string', enum: ['content', 'name'] },
      path: { type: 'string' },
      maxResults: { type: 'number' },
    },
    required: ['pattern'],
  },
  browser_navigate: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  browser_snapshot: { type: 'object', properties: {} },
  browser_click: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  browser_type: {
    type: 'object',
    properties: { ref: { type: 'string' }, text: { type: 'string' } },
    required: ['ref', 'text'],
  },
  browser_scroll: {
    type: 'object',
    properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } },
  },
  browser_back: { type: 'object', properties: {} },
  browser_press: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  browser_console: { type: 'object', properties: {} },
  terminal: {
    type: 'object',
    properties: { command: { type: 'string' }, background: { type: 'boolean' } },
    required: ['command'],
  },
  process: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'poll', 'log', 'kill'] },
      processId: { type: 'string' },
    },
    required: ['action'],
  },
  todo: {
    type: 'object',
    properties: {
      merge: { type: 'boolean' },
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content'],
        },
      },
    },
  },
  clarify: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      choices: { type: 'array', items: { type: 'string' } },
      mode: { type: 'string', enum: ['choice', 'freeform'] },
    },
    required: ['question'],
  },
  session_search: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'number' } },
    required: ['query'],
  },
  vision_analyze: {
    type: 'object',
    properties: {
      image_url: { type: 'string' },
      path: { type: 'string' },
      prompt: { type: 'string' },
    },
  },
  kanban_list: {
    type: 'object',
    properties: { board: { type: 'string' }, column: { type: 'string' } },
  },
  kanban_show: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  kanban_create: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      column: { type: 'string' },
      board: { type: 'string' },
    },
    required: ['title'],
  },
  kanban_move: {
    type: 'object',
    properties: { task_id: { type: 'string' }, column: { type: 'string' } },
    required: ['task_id', 'column'],
  },
  kanban_complete: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  kanban_block: {
    type: 'object',
    properties: { task_id: { type: 'string' }, agent_id: { type: 'string' }, reason: { type: 'string' } },
    required: ['task_id'],
  },
  kanban_unblock: {
    type: 'object',
    properties: { task_id: { type: 'string' }, agent_id: { type: 'string' } },
    required: ['task_id'],
  },
  kanban_heartbeat: {
    type: 'object',
    properties: { task_id: { type: 'string' }, agent_id: { type: 'string' }, note: { type: 'string' } },
    required: ['task_id'],
  },
  kanban_comment: {
    type: 'object',
    properties: { task_id: { type: 'string' }, comment: { type: 'string' } },
    required: ['task_id', 'comment'],
  },
  kanban_link: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      link: { type: 'string' },
      link_type: { type: 'string', enum: ['goal', 'task'] },
    },
    required: ['task_id', 'link'],
  },
  browser_get_images: { type: 'object', properties: {} },
  browser_vision: { type: 'object', properties: { prompt: { type: 'string' } } },
  browser_dialog: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['accept', 'dismiss'] }, text: { type: 'string' } },
    required: ['action'],
  },
  browser_cdp: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['evaluate', 'screenshot', 'title', 'url'] },
      params: { type: 'object' },
    },
    required: ['method'],
  },
  delegate_task: {
    type: 'object',
    properties: { agent: { type: 'string' }, task: { type: 'string' }, context: { type: 'string' } },
    required: ['agent', 'task'],
  },
  cronjob: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'run', 'create'] },
      slug: { type: 'string' },
      schedule: { type: 'string' },
      agent: { type: 'string' },
      prompt: { type: 'string' },
      timezone: { type: 'string' },
    },
    required: ['action'],
  },
  skills_list: { type: 'object', properties: {} },
  skill_view: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  send_message: {
    type: 'object',
    properties: { message: { type: 'string' }, channel: { type: 'string' } },
    required: ['message'],
  },
  ha_list_entities: { type: 'object', properties: { domain: { type: 'string' } } },
  ha_get_state: { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] },
  ha_list_services: { type: 'object', properties: {} },
  ha_call_service: {
    type: 'object',
    properties: {
      domain: { type: 'string' },
      service: { type: 'string' },
      entity_id: { type: 'string' },
      data: { type: 'object' },
    },
    required: ['domain', 'service'],
  },
  mixture_of_agents: {
    type: 'object',
    properties: {
      task: { type: 'string' },
      agents: { type: 'array', items: { type: 'string' } },
      synthesizer: { type: 'string' },
    },
    required: ['task', 'agents'],
  },
  x_search: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'number' } },
    required: ['query'],
  },
  video_analyze: {
    type: 'object',
    properties: { video_url: { type: 'string' }, path: { type: 'string' }, prompt: { type: 'string' } },
  },
  video_generate: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  computer_use: {
    type: 'object',
    properties: { action: { type: 'string' }, target: { type: 'string' } },
    required: ['action'],
  },
  discord_admin: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list_channels', 'list_members'] },
      guild_id: { type: 'string' },
    },
    required: ['guild_id'],
  },
  skill_manage: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['promote', 'list_drafts'] }, slug: { type: 'string' } },
    required: ['action'],
  },
  spotify_search: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  feishu_doc_read: { type: 'object', properties: { document_id: { type: 'string' } }, required: ['document_id'] },
  rl_tool: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list_environments',
          'select_environment',
          'get_current_config',
          'edit_config',
          'start_training',
          'check_status',
          'stop_training',
          'get_results',
          'list_runs',
          'test_inference',
        ],
      },
      params: { type: 'object' },
    },
    required: ['action'],
  },
  yb_tool: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['query_group_info', 'query_group_members', 'send_dm', 'search_sticker', 'send_sticker'],
      },
      params: { type: 'object' },
    },
    required: ['action'],
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
