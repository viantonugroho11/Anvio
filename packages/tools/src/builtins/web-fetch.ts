import type { BuiltinToolResult } from '@anvio/core';

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
