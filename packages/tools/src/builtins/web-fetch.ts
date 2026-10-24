import type { BuiltinToolResult } from '@anvio/core';
import { DEFAULT_EGRESS_POLICY, guardedFetch, readBodyCapped, withTimeout, type EgressPolicy } from './egress.js';

export async function webFetch(
  url: string,
  maxChars = 8000,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
  signal?: AbortSignal,
): Promise<BuiltinToolResult> {
  try {
    const { response: res } = await guardedFetch(
      url,
      { headers: { 'User-Agent': 'Anvio-ToolGateway/1.0' }, signal: withTimeout(15_000, signal) },
      policy,
    );
    if (!res.ok) {
      return { name: 'anvio_tools__web_fetch', output: null, status: 'failed', error: `HTTP ${res.status}` };
    }
    const { text } = await readBodyCapped(res, policy.maxResponseBytes);
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
