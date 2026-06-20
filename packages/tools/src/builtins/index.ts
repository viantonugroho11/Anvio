import type { BuiltinToolCall, BuiltinToolResult, CodeExecutor, ToolGatewaySpec } from '@anvio/core';
import { executeCodeWithExecutor, fileRead, fileWrite } from './filesystem.js';
import { browserAction } from './browser.js';
import { imageGenerate, textToSpeech } from './media.js';
import { webFetch } from './web-fetch.js';

export interface BuiltinToolContext {
  workspaceRoot?: string;
  codeExecutor?: CodeExecutor;
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
    default:
      return { name: call.name, output: null, status: 'skipped', error: 'Not implemented' };
  }
}
