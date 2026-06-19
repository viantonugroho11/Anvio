import type { BuiltinToolResult } from '@anvio/core';
import { webFetch } from './web-fetch.js';

export interface BrowserActionInput {
  url: string;
  action?: 'navigate' | 'screenshot' | 'content';
  selector?: string;
}

/** Playwright browser sandbox — falls back to web_fetch when Playwright is not installed. */
export async function browserAction(input: BrowserActionInput): Promise<BuiltinToolResult> {
  const { url, action = 'content', selector } = input;
  if (!url) {
    return { name: 'anvio_tools__browser', output: null, status: 'failed', error: 'url is required' };
  }

  try {
    const playwright = await tryLoadPlaywright();
    if (!playwright) {
      const fallback = await webFetch(url);
      return {
        name: 'anvio_tools__browser',
        output: {
          url,
          action,
          mode: 'fetch-fallback',
          note: 'Install playwright for full browser sandbox: pnpm add playwright -w',
          content: (fallback.output as { content?: string })?.content ?? '',
        },
        status: fallback.status === 'completed' ? 'completed' : fallback.status,
        error: fallback.error,
      };
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

      if (action === 'screenshot') {
        const buffer = await page.screenshot({ fullPage: false, type: 'png' });
        return {
          name: 'anvio_tools__browser',
          output: {
            url,
            action,
            screenshotBase64: buffer.toString('base64'),
            title: await page.title(),
          },
          status: 'completed',
        };
      }

      if (action === 'navigate') {
        return {
          name: 'anvio_tools__browser',
          output: {
            url: page.url(),
            title: await page.title(),
            action,
          },
          status: 'completed',
        };
      }

      const content = selector
        ? await page.locator(selector).first().textContent({ timeout: 5000 })
        : ((await page.textContent('body')) ?? '').slice(0, 12_000);

      return {
        name: 'anvio_tools__browser',
        output: { url, action: 'content', title: await page.title(), content: content ?? '' },
        status: 'completed',
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      name: 'anvio_tools__browser',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tryLoadPlaywright(): Promise<typeof import('playwright') | null> {
  if (process.env.ANVIO_BROWSER_MOCK === '1') return null;
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}
