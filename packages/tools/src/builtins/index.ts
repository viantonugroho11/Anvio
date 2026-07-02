import type { BuiltinToolCall, BuiltinToolResult, CodeExecutor, KanbanColumn, KanbanStore, ToolGatewaySpec } from '@anvio/core';
import { executeCodeWithExecutor, fileRead, fileWrite, listDir, editFile, pathExists, fileDelete, appendFile } from './filesystem.js';
import { browserAction } from './browser.js';
import {
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  browserScroll,
  browserBack,
  browserPress,
  browserConsole,
  browserGetImages,
  browserVision,
  browserDialog,
  browserCdp,
} from './browser-session.js';
import { imageGenerate, textToSpeech } from './media.js';
import { webFetch } from './web-fetch.js';
import { webExtract } from './web-extract.js';
import { patchFile } from './patch-file.js';
import { searchFiles } from './search-files.js';
import { httpRequest } from './network-tools.js';
import { jsonParse, datetimeNow } from './utility-tools.js';
import { runTerminal, manageProcess } from './process-manager.js';
import { todoTool, clarifyTool, sessionSearchTool, type SessionSearchFn } from './agent-session-tools.js';
import { visionAnalyze } from './vision-analyze.js';
import { kanbanListTasks, kanbanShowTask, kanbanCreateTask, kanbanMoveTask, kanbanCompleteTask, kanbanBlockTask, kanbanUnblockTask, kanbanHeartbeatTask, kanbanCommentTask, kanbanLinkTask } from './kanban-tools.js';
import {
  executeCodePipeline,
  globFiles,
  grepSearch,
} from './workspace-tools.js';
import { memoryRecall, type MemoryRecallFn } from './memory-recall.js';
import {
  delegateTaskTool,
  cronjobTool,
  skillsListTool,
  skillViewTool,
  sendMessageTool,
  mixtureOfAgentsTool,
  skillManageTool,
  type CronjobFn,
  type DelegateTaskFn,
  type GetSkillFn,
  type ListSkillsFn,
  type SendMessageFn,
  type MixtureOfAgentsFn,
  type SkillManageFn,
} from './orchestration-tools.js';
import { haListEntities, haGetState, haListServices, haCallService } from './homeassistant-tools.js';
import {
  xSearch,
  videoAnalyze,
  videoGenerate,
  computerUse,
  discordAdmin,
  spotifySearch,
  feishuDocRead,
  rlTool,
  yuanbaoTool,
  type RlAction,
  type YbAction,
  type McpDelegateFn,
} from './niche-tools.js';

export interface BuiltinToolContext {
  workspaceRoot?: string;
  codeExecutor?: CodeExecutor;
  memoryRecall?: MemoryRecallFn;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  searchSessions?: SessionSearchFn;
  kanban?: KanbanStore;
  delegateTask?: DelegateTaskFn;
  manageCronjob?: CronjobFn;
  listSkills?: ListSkillsFn;
  getSkill?: GetSkillFn;
  sendMessage?: SendMessageFn;
  mixtureOfAgents?: MixtureOfAgentsFn;
  skillManage?: SkillManageFn;
  callMcpTool?: McpDelegateFn;
}

export { webFetch } from './web-fetch.js';

export async function webSearch(query: string, apiKey?: string): Promise<BuiltinToolResult> {
  if (!apiKey) {
    return {
      name: 'anvio_tools__web_search',
      output: { query, results: [], note: 'Set WEB_SEARCH_API_KEY for live search' },
      status: 'completed',
    };
  }
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { name: 'anvio_tools__web_search', output: null, status: 'failed', error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string }> } };
    const results = (data.web?.results ?? []).slice(0, 5).map((r) => ({ title: r.title, url: r.url }));
    return { name: 'anvio_tools__web_search', output: { query, results }, status: 'completed' };
  } catch (error) {
    return {
      name: 'anvio_tools__web_search',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeCode(code: string, language = 'javascript'): Promise<BuiltinToolResult> {
  if (language !== 'javascript') {
    return {
      name: 'anvio_tools__execute_code',
      output: null,
      status: 'skipped',
      error: `Language ${language} not supported in Phase H`,
    };
  }
  try {
    const fn = new Function(`"use strict"; return (async () => { ${code} })();`);
    const output = await fn();
    return { name: 'anvio_tools__execute_code', output, status: 'completed' };
  } catch (error) {
    return {
      name: 'anvio_tools__execute_code',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runBuiltinTool(
  spec: ToolGatewaySpec,
  call: BuiltinToolCall,
  ctx: BuiltinToolContext = {},
): Promise<BuiltinToolResult> {
  const toolKey = call.name.replace(/^anvio_tools__/, '') as keyof ToolGatewaySpec['tools'];
  const toolConfig = spec.tools[toolKey];
  if (!spec.enabled || !toolConfig?.enabled) {
    return { name: call.name, output: null, status: 'skipped', error: 'Tool disabled' };
  }

  switch (toolKey) {
    case 'web_fetch':
      return webFetch(String(call.arguments.url ?? ''));
    case 'web_search':
      return webSearch(
        String(call.arguments.query ?? ''),
        process.env[spec.webSearch.apiKeyEnv],
      );
    case 'execute_code':
      if (ctx.codeExecutor) {
        try {
          const out = await executeCodeWithExecutor(
            ctx.codeExecutor,
            String(call.arguments.code ?? ''),
            String(call.arguments.language ?? 'javascript'),
          );
          return {
            name: call.name,
            output: out,
            status: out.exitCode === 0 ? 'completed' : 'failed',
            error: out.exitCode === 0 ? undefined : out.stderr,
          };
        } catch (error) {
          return {
            name: call.name,
            output: null,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return executeCode(String(call.arguments.code ?? ''), String(call.arguments.language ?? 'javascript'));
    case 'file_read': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await fileRead(ctx.workspaceRoot, String(call.arguments.path ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'file_write': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await fileWrite(
          ctx.workspaceRoot,
          String(call.arguments.path ?? ''),
          String(call.arguments.content ?? ''),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'browser':
      return browserAction({
        url: String(call.arguments.url ?? ''),
        action: (call.arguments.action as 'navigate' | 'screenshot' | 'content') ?? 'content',
        selector: call.arguments.selector ? String(call.arguments.selector) : undefined,
      });
    case 'image_generate':
      return imageGenerate(String(call.arguments.prompt ?? ''), {
        workspaceRoot: ctx.workspaceRoot,
        size: call.arguments.size ? String(call.arguments.size) : undefined,
      });
    case 'text_to_speech':
      return textToSpeech(String(call.arguments.text ?? ''), {
        workspaceRoot: ctx.workspaceRoot,
      });
    case 'glob_files': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await globFiles(
          ctx.workspaceRoot,
          String(call.arguments.pattern ?? '**/*'),
          Number(call.arguments.maxResults ?? 50),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'grep_search': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await grepSearch(
          ctx.workspaceRoot,
          String(call.arguments.pattern ?? ''),
          call.arguments.path ? String(call.arguments.path) : '.',
          Number(call.arguments.maxResults ?? 30),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'execute_code_pipeline': {
      if (!ctx.codeExecutor) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: 'codeExecutor required for execute_code_pipeline',
        };
      }
      try {
        const steps = (call.arguments.steps as Array<{ code: string; language?: string }> | undefined) ?? [];
        const out = await executeCodePipeline(ctx.codeExecutor, steps);
        const failed = out.steps.find((s) => s.exitCode !== 0);
        return {
          name: call.name,
          output: out,
          status: failed ? 'failed' : 'completed',
          error: failed?.stderr,
        };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'memory_recall':
      return memoryRecall(
        ctx.memoryRecall,
        String(call.arguments.userId ?? ctx.userId ?? 'local-user'),
        String(call.arguments.query ?? ''),
        Number(call.arguments.limit ?? 10),
      );
    case 'list_dir': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await listDir(ctx.workspaceRoot, String(call.arguments.path ?? '.'));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'edit_file': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await editFile(
          ctx.workspaceRoot,
          String(call.arguments.path ?? ''),
          String(call.arguments.old_string ?? ''),
          String(call.arguments.new_string ?? ''),
          Boolean(call.arguments.replace_all),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'run_shell': {
      if (!ctx.codeExecutor) {
        return { name: call.name, output: null, status: 'failed', error: 'codeExecutor required for run_shell' };
      }
      try {
        const command = String(call.arguments.command ?? '');
        const out = await executeCodeWithExecutor(ctx.codeExecutor, command, 'shell');
        return {
          name: call.name,
          output: { command, ...out },
          status: out.exitCode === 0 ? 'completed' : 'failed',
          error: out.exitCode === 0 ? undefined : out.stderr,
        };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'http_request':
      try {
        const headers = call.arguments.headers as Record<string, string> | undefined;
        const out = await httpRequest({
          url: String(call.arguments.url ?? ''),
          method: call.arguments.method ? String(call.arguments.method) : undefined,
          headers,
          body: call.arguments.body ? String(call.arguments.body) : undefined,
          timeoutMs: call.arguments.timeoutMs ? Number(call.arguments.timeoutMs) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    case 'path_exists': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await pathExists(ctx.workspaceRoot, String(call.arguments.path ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'file_delete': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await fileDelete(ctx.workspaceRoot, String(call.arguments.path ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'append_file': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await appendFile(
          ctx.workspaceRoot,
          String(call.arguments.path ?? ''),
          String(call.arguments.content ?? ''),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case 'json_parse': {
      const parsed = jsonParse(String(call.arguments.text ?? ''));
      if (!parsed.valid) {
        return { name: call.name, output: parsed, status: 'failed', error: parsed.error };
      }
      return { name: call.name, output: parsed, status: 'completed' };
    }
    case 'datetime_now': {
      const out = datetimeNow(call.arguments.timezone ? String(call.arguments.timezone) : undefined);
      return { name: call.name, output: out, status: 'completed' };
    }
    case 'web_extract':
      return webExtract(String(call.arguments.url ?? ''));
    case 'patch_file': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const out = await patchFile(
          ctx.workspaceRoot,
          String(call.arguments.path ?? ''),
          String(call.arguments.old_string ?? ''),
          String(call.arguments.new_string ?? ''),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'search_files': {
      if (!ctx.workspaceRoot) {
        return { name: call.name, output: null, status: 'failed', error: 'workspaceRoot required' };
      }
      try {
        const target = call.arguments.target === 'name' ? 'name' : 'content';
        const out = await searchFiles(
          ctx.workspaceRoot,
          String(call.arguments.pattern ?? ''),
          target,
          call.arguments.path ? String(call.arguments.path) : '.',
          Number(call.arguments.maxResults ?? 30),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'browser_navigate':
      return browserNavigate(String(call.arguments.url ?? ''), ctx.sessionId);
    case 'browser_snapshot':
      return browserSnapshot(ctx.sessionId);
    case 'browser_click':
      return browserClick(String(call.arguments.ref ?? call.arguments.selector ?? ''), ctx.sessionId);
    case 'browser_type':
      return browserType(String(call.arguments.ref ?? ''), String(call.arguments.text ?? ''), ctx.sessionId);
    case 'browser_scroll':
      return browserScroll(
        call.arguments.direction === 'up' ? 'up' : 'down',
        Number(call.arguments.amount ?? 500),
        ctx.sessionId,
      );
    case 'browser_back':
      return browserBack(ctx.sessionId);
    case 'browser_press':
      return browserPress(String(call.arguments.key ?? 'Enter'), ctx.sessionId);
    case 'browser_console':
      return browserConsole(ctx.sessionId);
    case 'terminal': {
      try {
        const out = await runTerminal(ctx.codeExecutor, String(call.arguments.command ?? ''), Boolean(call.arguments.background));
        return {
          name: call.name,
          output: out,
          status: out.exitCode === 0 ? 'completed' : 'failed',
          error: out.exitCode === 0 ? undefined : out.stderr,
        };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'process': {
      try {
        const action = String(call.arguments.action ?? 'list') as 'list' | 'poll' | 'log' | 'kill';
        const out = manageProcess(action, call.arguments.processId ? String(call.arguments.processId) : undefined);
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'todo': {
      const out = todoTool(ctx.sessionId ?? 'default', {
        todos: call.arguments.todos as Array<{ id?: string; content: string; status?: 'pending' | 'in_progress' | 'completed' }> | undefined,
        merge: Boolean(call.arguments.merge),
      });
      return { name: call.name, output: out, status: 'completed' };
    }
    case 'clarify': {
      const out = clarifyTool({
        question: String(call.arguments.question ?? ''),
        choices: call.arguments.choices as string[] | undefined,
        mode: call.arguments.mode as 'choice' | 'freeform' | undefined,
      });
      return { name: call.name, output: out, status: 'completed' };
    }
    case 'session_search': {
      const out = await sessionSearchTool(
        ctx.searchSessions,
        String(call.arguments.query ?? ''),
        Number(call.arguments.limit ?? 10),
      );
      return { name: call.name, output: out, status: 'completed' };
    }
    case 'vision_analyze':
      return visionAnalyze(
        String(call.arguments.image_url ?? call.arguments.path ?? ''),
        call.arguments.prompt ? String(call.arguments.prompt) : undefined,
      );
    case 'kanban_list': {
      try {
        const out = await kanbanListTasks(
          ctx.kanban,
          call.arguments.board ? String(call.arguments.board) : undefined,
          call.arguments.column as KanbanColumn | undefined,
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_show': {
      try {
        const out = await kanbanShowTask(ctx.kanban, String(call.arguments.task_id ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_create': {
      try {
        const out = await kanbanCreateTask(ctx.kanban, {
          title: String(call.arguments.title ?? ''),
          description: call.arguments.description ? String(call.arguments.description) : undefined,
          column: call.arguments.column as KanbanColumn | undefined,
          board: call.arguments.board ? String(call.arguments.board) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_move': {
      try {
        const out = await kanbanMoveTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.column ?? 'done') as KanbanColumn,
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_complete': {
      try {
        const out = await kanbanCompleteTask(ctx.kanban, String(call.arguments.task_id ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_block': {
      try {
        const out = await kanbanBlockTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.agent_id ?? ctx.agentId ?? 'agent'),
          call.arguments.reason ? String(call.arguments.reason) : undefined,
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_unblock': {
      try {
        const out = await kanbanUnblockTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.agent_id ?? ctx.agentId ?? 'agent'),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_heartbeat': {
      try {
        const out = await kanbanHeartbeatTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.agent_id ?? ctx.agentId ?? 'agent'),
          call.arguments.note ? String(call.arguments.note) : undefined,
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_comment': {
      try {
        const out = await kanbanCommentTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.comment ?? ''),
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'kanban_link': {
      try {
        const linkType = call.arguments.link_type === 'task' ? 'task' : 'goal';
        const out = await kanbanLinkTask(
          ctx.kanban,
          String(call.arguments.task_id ?? ''),
          String(call.arguments.link ?? ''),
          linkType,
        );
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'browser_get_images':
      return browserGetImages(ctx.sessionId);
    case 'browser_vision':
      return browserVision(call.arguments.prompt ? String(call.arguments.prompt) : undefined, ctx.sessionId);
    case 'browser_dialog':
      return browserDialog(
        call.arguments.action === 'dismiss' ? 'dismiss' : 'accept',
        call.arguments.text ? String(call.arguments.text) : undefined,
        ctx.sessionId,
      );
    case 'browser_cdp':
      return browserCdp(
        String(call.arguments.method ?? 'evaluate'),
        (call.arguments.params as Record<string, unknown> | undefined) ?? {},
        ctx.sessionId,
      );
    case 'delegate_task': {
      try {
        const out = await delegateTaskTool(ctx.delegateTask, {
          agent: String(call.arguments.agent ?? ''),
          task: String(call.arguments.task ?? ''),
          context: call.arguments.context ? String(call.arguments.context) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'cronjob': {
      try {
        const out = await cronjobTool(ctx.manageCronjob, {
          action: String(call.arguments.action ?? 'list') as 'list' | 'run' | 'create',
          slug: call.arguments.slug ? String(call.arguments.slug) : undefined,
          schedule: call.arguments.schedule ? String(call.arguments.schedule) : undefined,
          agent: call.arguments.agent ? String(call.arguments.agent) : undefined,
          prompt: call.arguments.prompt ? String(call.arguments.prompt) : undefined,
          timezone: call.arguments.timezone ? String(call.arguments.timezone) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'skills_list': {
      try {
        const out = await skillsListTool(ctx.listSkills);
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'skill_view': {
      try {
        const out = await skillViewTool(ctx.getSkill, String(call.arguments.slug ?? ''));
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'send_message': {
      try {
        const out = await sendMessageTool(ctx.sendMessage, {
          message: String(call.arguments.message ?? ''),
          channel: call.arguments.channel ? String(call.arguments.channel) : undefined,
          sessionId: ctx.sessionId,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'ha_list_entities':
      return haListEntities(call.arguments.domain ? String(call.arguments.domain) : undefined);
    case 'ha_get_state':
      return haGetState(String(call.arguments.entity_id ?? ''));
    case 'ha_list_services':
      return haListServices();
    case 'ha_call_service':
      return haCallService(
        String(call.arguments.domain ?? ''),
        String(call.arguments.service ?? ''),
        call.arguments.entity_id ? String(call.arguments.entity_id) : undefined,
        call.arguments.data as Record<string, unknown> | undefined,
      );
    case 'mixture_of_agents': {
      try {
        const agents = (call.arguments.agents as string[] | undefined) ?? [];
        const out = await mixtureOfAgentsTool(ctx.mixtureOfAgents, {
          task: String(call.arguments.task ?? ''),
          agents,
          synthesizer: call.arguments.synthesizer ? String(call.arguments.synthesizer) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'x_search':
      return xSearch(String(call.arguments.query ?? ''), Number(call.arguments.limit ?? 10));
    case 'video_analyze':
      return videoAnalyze(
        String(call.arguments.video_url ?? call.arguments.path ?? ''),
        call.arguments.prompt ? String(call.arguments.prompt) : undefined,
      );
    case 'video_generate':
      return videoGenerate(String(call.arguments.prompt ?? ''), ctx.callMcpTool);
    case 'computer_use':
      return computerUse(
        String(call.arguments.action ?? 'click'),
        call.arguments.target ? String(call.arguments.target) : undefined,
      );
    case 'discord_admin':
      return discordAdmin(
        call.arguments.action === 'list_members' ? 'list_members' : 'list_channels',
        String(call.arguments.guild_id ?? ''),
      );
    case 'skill_manage': {
      try {
        const out = await skillManageTool(ctx.skillManage, {
          action: call.arguments.action === 'promote' ? 'promote' : 'list_drafts',
          slug: call.arguments.slug ? String(call.arguments.slug) : undefined,
        });
        return { name: call.name, output: out, status: 'completed' };
      } catch (error) {
        return { name: call.name, output: null, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'spotify_search':
      return spotifySearch(String(call.arguments.query ?? ''), ctx.callMcpTool);
    case 'feishu_doc_read':
      return feishuDocRead(String(call.arguments.document_id ?? ''), ctx.callMcpTool);
    case 'rl_tool':
      return rlTool(
        String(call.arguments.action ?? 'list_environments') as RlAction,
        (call.arguments.params as Record<string, unknown> | undefined) ?? {},
        ctx.callMcpTool,
      );
    case 'yb_tool':
      return yuanbaoTool(
        String(call.arguments.action ?? 'query_group_info') as YbAction,
        (call.arguments.params as Record<string, unknown> | undefined) ?? {},
        ctx.callMcpTool,
      );
    default:
      return { name: call.name, output: null, status: 'skipped', error: 'Not implemented' };
  }
}
