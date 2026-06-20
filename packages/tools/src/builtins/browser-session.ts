import type { BuiltinToolResult } from '@anvio/core';
import { visionAnalyze } from './vision-analyze.js';

type PlaywrightModule = typeof import('playwright');
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

interface BrowserSession {
  browser: Browser;
  page: Page;
  refs: Map<string, { selector: string }>;
  lastUsed: number;
}

const sessions = new Map<string, BrowserSession>();
const SESSION_TTL_MS = 30 * 60_000;

function sessionKey(key?: string): string {
  return key ?? 'default';
}

async function tryLoadPlaywright(): Promise<PlaywrightModule | null> {
  if (process.env.ANVIO_BROWSER_MOCK === '1') return null;
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

async function getSession(key?: string): Promise<BrowserSession> {
  cleanupStaleSessions();
  const id = sessionKey(key);
  const existing = sessions.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const pw = await tryLoadPlaywright();
  if (!pw) {
    throw new Error('Playwright not installed — pnpm add playwright -w');
  }
  const browser = await pw.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const session: BrowserSession = { browser, page, refs: new Map(), lastUsed: Date.now() };
  sessions.set(id, session);
  return session;
}

function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > SESSION_TTL_MS) {
      void s.browser.close();
      sessions.delete(id);
    }
  }
}

async function refreshRefs(session: BrowserSession): Promise<Array<{ ref: string; role: string; name: string }>> {
  const elements = await session.page.locator('a, button, input, textarea, select, [role=button]').all();
  session.refs.clear();
  const out: Array<{ ref: string; role: string; name: string }> = [];
  for (let i = 0; i < Math.min(elements.length, 40); i++) {
    const ref = `@e${i + 1}`;
    const el = elements[i]!;
    const tag = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => 'element');
    const name =
      (await el.getAttribute('aria-label').catch(() => null)) ??
      (await el.textContent().catch(() => null))?.trim().slice(0, 80) ??
      tag;
    session.refs.set(ref, { selector: `nth=${i}` });
    out.push({ ref, role: tag, name });
  }
  return out;
}

function resolveRef(session: BrowserSession, refOrSelector: string): string {
  if (refOrSelector.startsWith('@')) {
    const mapped = session.refs.get(refOrSelector);
    if (!mapped) throw new Error(`Unknown ref ${refOrSelector} — call browser_snapshot first`);
    return mapped.selector;
  }
  return refOrSelector;
}

export async function browserNavigate(
  url: string,
  sessionId?: string,
): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    return {
      name: 'anvio_tools__browser_navigate',
      output: { url: session.page.url(), title: await session.page.title() },
      status: 'completed',
    };
  } catch (error) {
    return fail('browser_navigate', error);
  }
}

export async function browserSnapshot(sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const elements = await refreshRefs(session);
    const text = ((await session.page.textContent('body')) ?? '').slice(0, 8000);
    return {
      name: 'anvio_tools__browser_snapshot',
      output: { url: session.page.url(), title: await session.page.title(), elements, textPreview: text.slice(0, 2000) },
      status: 'completed',
    };
  } catch (error) {
    return fail('browser_snapshot', error);
  }
}

export async function browserClick(ref: string, sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const selector = resolveRef(session, ref);
    await session.page.locator('a, button, input, textarea, select, [role=button]').nth(Number(selector.replace('nth=', ''))).click({ timeout: 8000 });
    return { name: 'anvio_tools__browser_click', output: { ref, url: session.page.url() }, status: 'completed' };
  } catch (error) {
    return fail('browser_click', error);
  }
}

export async function browserType(ref: string, text: string, sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const selector = resolveRef(session, ref);
    const loc = session.page.locator('a, button, input, textarea, select, [role=button]').nth(Number(selector.replace('nth=', '')));
    await loc.fill(text, { timeout: 8000 });
    return { name: 'anvio_tools__browser_type', output: { ref, typed: text.length }, status: 'completed' };
  } catch (error) {
    return fail('browser_type', error);
  }
}

export async function browserScroll(direction: 'up' | 'down', amount = 500, sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const delta = direction === 'down' ? amount : -amount;
    await session.page.mouse.wheel(0, delta);
    return { name: 'anvio_tools__browser_scroll', output: { direction, amount }, status: 'completed' };
  } catch (error) {
    return fail('browser_scroll', error);
  }
}

export async function browserBack(sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    await session.page.goBack({ timeout: 10_000 });
    return { name: 'anvio_tools__browser_back', output: { url: session.page.url() }, status: 'completed' };
  } catch (error) {
    return fail('browser_back', error);
  }
}

export async function browserPress(key: string, sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    await session.page.keyboard.press(key);
    return { name: 'anvio_tools__browser_press', output: { key }, status: 'completed' };
  } catch (error) {
    return fail('browser_press', error);
  }
}

export async function browserConsole(sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const logs: string[] = [];
    session.page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    await session.page.waitForTimeout(100);
    return { name: 'anvio_tools__browser_console', output: { logs: logs.slice(-20) }, status: 'completed' };
  } catch (error) {
    return fail('browser_console', error);
  }
}

export async function browserGetImages(sessionId?: string): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const images = await session.page.$$eval('img', (nodes) =>
      nodes.slice(0, 20).map((img) => ({
        src: img.getAttribute('src') ?? '',
        alt: img.getAttribute('alt') ?? '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    );
    return {
      name: 'anvio_tools__browser_get_images',
      output: { url: session.page.url(), images },
      status: 'completed',
    };
  } catch (error) {
    return fail('browser_get_images', error);
  }
}

export async function browserVision(
  prompt = 'Describe the current page visually.',
  sessionId?: string,
): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const screenshot = await session.page.screenshot({ type: 'png', fullPage: false });
    const dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;
    const result = await visionAnalyze(dataUrl, prompt);
    return {
      name: 'anvio_tools__browser_vision',
      output: { url: session.page.url(), ...(result.output as Record<string, unknown>) },
      status: result.status,
      error: result.error,
    };
  } catch (error) {
    return fail('browser_vision', error);
  }
}

export async function browserDialog(
  action: 'accept' | 'dismiss',
  text?: string,
  sessionId?: string,
): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    session.page.once('dialog', async (dialog) => {
      if (action === 'accept') {
        await dialog.accept(text);
      } else {
        await dialog.dismiss();
      }
    });
    return {
      name: 'anvio_tools__browser_dialog',
      output: { armed: true, action, note: 'Handler armed for next dialog on this session' },
      status: 'completed',
    };
  } catch (error) {
    return fail('browser_dialog', error);
  }
}

const CDP_ALLOWED = new Set(['evaluate', 'screenshot', 'title', 'url'] as const);
type CdpMethod = 'evaluate' | 'screenshot' | 'title' | 'url';

export async function browserCdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<BuiltinToolResult> {
  try {
    const session = await getSession(sessionId);
    const m = method.toLowerCase() as CdpMethod;
    if (!CDP_ALLOWED.has(m)) {
      throw new Error(`Method not allowed. Allowed: ${[...CDP_ALLOWED].join(', ')}`);
    }
    let output: unknown;
    switch (m) {
      case 'evaluate':
        output = await session.page.evaluate(String(params.expression ?? 'document.title'));
        break;
      case 'screenshot': {
        const buf = await session.page.screenshot({ type: 'png', fullPage: Boolean(params.fullPage) });
        output = { base64: buf.toString('base64').slice(0, 200) + '…', size: buf.length };
        break;
      }
      case 'title':
        output = { title: await session.page.title() };
        break;
      case 'url':
        output = { url: session.page.url() };
        break;
      default: {
        const _exhaustive: never = m;
        throw new Error(`Unhandled CDP method: ${_exhaustive}`);
      }
    }
    return { name: 'anvio_tools__browser_cdp', output: { method: m, result: output }, status: 'completed' };
  } catch (error) {
    return fail('browser_cdp', error);
  }
}

function fail(tool: string, error: unknown): BuiltinToolResult {
  return {
    name: `anvio_tools__${tool}`,
    output: null,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function closeBrowserSession(sessionId?: string): Promise<void> {
  const id = sessionKey(sessionId);
  const s = sessions.get(id);
  if (s) {
    await s.browser.close();
    sessions.delete(id);
  }
}
