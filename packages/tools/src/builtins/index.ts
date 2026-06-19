import type { BuiltinToolCall, BuiltinToolResult, ToolGatewaySpec } from '@anvio/core';

export async function webFetch(url: string, maxChars = 8000): Promise<BuiltinToolResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Anvio-ToolGateway/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { name: 'anvio_tools__web_fetch', output: null, status: 'failed', error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
    return {
      name: 'anvio_tools__web_fetch',
      output: { url, content: stripped.slice(0, maxChars) },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__web_fetch',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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
      return executeCode(String(call.arguments.code ?? ''), String(call.arguments.language ?? 'javascript'));
    default:
      return { name: call.name, output: null, status: 'skipped', error: 'Not implemented' };
  }
}
