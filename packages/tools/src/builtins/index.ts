import type { BuiltinToolCall, BuiltinToolResult, CodeExecutor, ToolGatewaySpec } from '@anvio/core';
import { executeCodeWithExecutor, fileRead, fileWrite, listDir, editFile, pathExists, fileDelete, appendFile } from './filesystem.js';
import { browserAction } from './browser.js';
import { imageGenerate, textToSpeech } from './media.js';
import { webFetch } from './web-fetch.js';
import { httpRequest } from './network-tools.js';
import { jsonParse, datetimeNow } from './utility-tools.js';
import {
  executeCodePipeline,
  globFiles,
  grepSearch,
} from './workspace-tools.js';
import { memoryRecall, type MemoryRecallFn } from './memory-recall.js';

export interface BuiltinToolContext {
  workspaceRoot?: string;
  codeExecutor?: CodeExecutor;
  memoryRecall?: MemoryRecallFn;
  userId?: string;
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
    default:
      return { name: call.name, output: null, status: 'skipped', error: 'Not implemented' };
  }
}
