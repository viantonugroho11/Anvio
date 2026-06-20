import type { BuiltinToolResult } from '@anvio/core';

/** Hermes-style web_extract — fetch URL and return markdown-ish content. */
export async function webExtract(url: string, maxChars = 12_000): Promise<BuiltinToolResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Anvio-ToolGateway/1.0', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { name: 'anvio_tools__web_extract', output: null, status: 'failed', error: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let markdown: string;
    if (contentType.includes('pdf')) {
      markdown = `[PDF content at ${url} — use file_read if downloaded locally]\n${text.slice(0, 500)}`;
    } else {
      markdown = htmlToMarkdown(text);
    }
    return {
      name: 'anvio_tools__web_extract',
      output: { url, markdown: markdown.slice(0, maxChars), length: markdown.length },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__web_extract',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function htmlToMarkdown(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}
