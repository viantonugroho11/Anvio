import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BuiltinToolResult } from '@anvio/core';
import { visionAnalyze } from './vision-analyze.js';

export type McpDelegateFn = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ output: unknown; status: 'completed' | 'failed'; error?: string }>;

async function tryMcp(
  fn: McpDelegateFn | undefined,
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<BuiltinToolResult | null> {
  if (!fn) return null;
  try {
    const result = await fn(serverId, toolName, args);
    return {
      name: `anvio_tools__${toolName}`,
      output: result.output,
      status: result.status,
      error: result.error,
    };
  } catch {
    return null;
  }
}

export async function xSearch(query: string, limit = 10): Promise<BuiltinToolResult> {
  const bearer = process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN;
  if (bearer) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${Math.min(limit, 100)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string; text: string }> };
        return {
          name: 'anvio_tools__x_search',
          output: { query, tweets: data.data ?? [] },
          status: 'completed',
        };
      }
    } catch {
      // fall through to web fallback
    }
  }

  const apiKey = process.env.WEB_SEARCH_API_KEY;
  if (apiKey) {
    try {
      const siteQuery = `${query} site:x.com OR site:twitter.com`;
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(siteQuery)}`;
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
        return {
          name: 'anvio_tools__x_search',
          output: {
            query,
            results: (data.web?.results ?? []).slice(0, limit),
            note: 'X API unavailable — Brave site-scoped fallback',
          },
          status: 'completed',
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    name: 'anvio_tools__x_search',
    output: { query, results: [], note: 'Set X_BEARER_TOKEN or WEB_SEARCH_API_KEY for x_search' },
    status: 'completed',
  };
}

function isVideoMockMode(): boolean {
  return process.env.ANVIO_VIDEO_MOCK === '1';
}

function ffmpegBinary(): string {
  return process.env.FFMPEG_BINARY ?? 'ffmpeg';
}

const VIDEO_FILE_EXT = /\.(mp4|mov|avi|mkv|webm|m4v)(\?.*)?$/i;

/** Extract a single frame via ffmpeg to a temp PNG. Returns null if ffmpeg is unavailable or fails. */
async function extractVideoFrame(videoUrlOrPath: string, atSeconds = 1): Promise<string | null> {
  const outFile = path.join(os.tmpdir(), `anvio-video-frame-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  const result = spawnSync(
    ffmpegBinary(),
    ['-y', '-ss', String(atSeconds), '-i', videoUrlOrPath, '-frames:v', '1', outFile],
    { encoding: 'utf-8', timeout: 30_000 },
  );
  if (result.error || result.status !== 0) return null;
  try {
    await fs.access(outFile);
    return outFile;
  } catch {
    return null;
  }
}

/** Analyze video content — extracts a frame via ffmpeg (local file or remote URL) then delegates to vision_analyze. */
export async function videoAnalyze(
  videoUrlOrPath: string,
  prompt = 'Summarize this video content.',
): Promise<BuiltinToolResult> {
  if (isVideoMockMode()) {
    return {
      name: 'anvio_tools__video_analyze',
      output: { videoUrlOrPath, prompt, analysis: 'Mock video analysis — frame sampled at 1s.', mock: true },
      status: 'completed',
    };
  }

  const isRemote = videoUrlOrPath.startsWith('http://') || videoUrlOrPath.startsWith('https://');
  const isVideoFile = VIDEO_FILE_EXT.test(videoUrlOrPath);

  if (isRemote || isVideoFile) {
    const framePath = await extractVideoFrame(videoUrlOrPath);
    if (!framePath) {
      return {
        name: 'anvio_tools__video_analyze',
        output: {
          videoUrlOrPath,
          prompt,
          note: 'ffmpeg frame extraction failed — install ffmpeg (FFMPEG_BINARY to override the binary path) or set ANVIO_VIDEO_MOCK=1 for local dev.',
        },
        status: 'completed',
      };
    }
    try {
      const result = await visionAnalyze(framePath, prompt);
      return {
        ...result,
        name: 'anvio_tools__video_analyze',
        output: { ...(result.output as Record<string, unknown> | null), videoUrlOrPath, frameExtracted: true },
      };
    } finally {
      await fs.unlink(framePath).catch(() => {});
    }
  }

  return visionAnalyze(videoUrlOrPath, prompt);
}

export async function videoGenerate(prompt: string, mcp?: McpDelegateFn): Promise<BuiltinToolResult> {
  const mcpResult = await tryMcp(mcp, 'video-gen', 'video_generate', { prompt });
  if (mcpResult) {
    mcpResult.name = 'anvio_tools__video_generate';
    return mcpResult;
  }

  if (isVideoMockMode()) {
    return {
      name: 'anvio_tools__video_generate',
      output: { prompt, videoUrl: 'mock://video-gen/result.mp4', mock: true },
      status: 'completed',
    };
  }

  return {
    name: 'anvio_tools__video_generate',
    output: {
      prompt,
      note: 'Video generation requires MCP preset (workspace/mcp/presets/video-gen.yaml.example) or ANVIO_VIDEO_MOCK=1 for local dev.',
    },
    status: 'completed',
  };
}

export async function computerUse(action: string, target?: string): Promise<BuiltinToolResult> {
  return {
    name: 'anvio_tools__computer_use',
    output: {
      action,
      target,
      note: 'computer_use requires macOS CUA driver (Hermes cua-driver). Not available in headless Linux sandbox.',
      status: 'unsupported',
    },
    status: 'skipped',
    error: 'computer_use not available in this runtime',
  };
}

export async function discordAdmin(
  action: 'list_channels' | 'list_members',
  guildId: string,
): Promise<BuiltinToolResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return {
      name: 'anvio_tools__discord_admin',
      output: { note: 'Set DISCORD_BOT_TOKEN for discord_admin' },
      status: 'completed',
    };
  }
  try {
    const path = action === 'list_channels' ? `/guilds/${guildId}/channels` : `/guilds/${guildId}/members?limit=100`;
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        name: 'anvio_tools__discord_admin',
        output: null,
        status: 'failed',
        error: `Discord API HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    return { name: 'anvio_tools__discord_admin', output: { action, guildId, data }, status: 'completed' };
  } catch (error) {
    return {
      name: 'anvio_tools__discord_admin',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function spotifySearch(
  query: string,
  mcp?: McpDelegateFn,
): Promise<BuiltinToolResult> {
  const mcpResult = await tryMcp(mcp, 'spotify', 'spotify_search', { query });
  if (mcpResult) {
    mcpResult.name = 'anvio_tools__spotify_search';
    return mcpResult;
  }
  const token = process.env.SPOTIFY_ACCESS_TOKEN;
  if (token) {
    try {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,album,artist&limit=5`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        return { name: 'anvio_tools__spotify_search', output: { query, results: data }, status: 'completed' };
      }
    } catch {
      // fall through
    }
  }
  return {
    name: 'anvio_tools__spotify_search',
    output: {
      query,
      note: 'Enable MCP spotify server (workspace/mcp/presets/spotify.yaml.example) or set SPOTIFY_ACCESS_TOKEN',
    },
    status: 'completed',
  };
}

export async function feishuDocRead(documentId: string, mcp?: McpDelegateFn): Promise<BuiltinToolResult> {
  const mcpResult = await tryMcp(mcp, 'feishu', 'feishu_doc_read', { document_id: documentId });
  if (mcpResult) {
    mcpResult.name = 'anvio_tools__feishu_doc_read';
    return mcpResult;
  }
  return {
    name: 'anvio_tools__feishu_doc_read',
    output: {
      documentId,
      note: 'Configure Feishu MCP preset (workspace/mcp/presets/feishu.yaml.example)',
    },
    status: 'completed',
  };
}

const RL_ACTIONS = [
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
] as const;

export type RlAction = (typeof RL_ACTIONS)[number];

function isAtroposMockMode(): boolean {
  return process.env.ANVIO_ATROPOS_MOCK === '1';
}

/** Deterministic synthetic responses for ANVIO_ATROPOS_MOCK=1 (dev/test — no network). */
function mockAtroposResult(action: RlAction, params: Record<string, unknown>): Record<string, unknown> {
  switch (action) {
    case 'list_environments':
      return { environments: ['tinker-atropos-demo'], mock: true };
    case 'select_environment':
      return { selected: params.environment ?? 'tinker-atropos-demo', mock: true };
    case 'get_current_config':
      return { config: {}, mock: true };
    case 'edit_config':
      return { config: params, updated: true, mock: true };
    case 'start_training':
      return { jobId: `mock-rl-${Date.now()}`, status: 'queued', mock: true };
    case 'check_status':
      return { jobId: params.jobId ?? null, status: 'running', progress: 0.42, mock: true };
    case 'stop_training':
      return { jobId: params.jobId ?? null, status: 'stopped', mock: true };
    case 'get_results':
      return { jobId: params.jobId ?? null, metrics: { reward: 0.81 }, mock: true };
    case 'list_runs':
      return { runs: [], mock: true };
    case 'test_inference':
      return { output: 'mock inference result', mock: true };
    default:
      return { mock: true };
  }
}

/**
 * Direct Tinker-Atropos HTTP fallback — used when no MCP delegate is wired.
 * Returns null (caller falls through to the static setup note) unless
 * ATROPOS_API_URL or ANVIO_ATROPOS_MOCK=1 is set.
 */
async function atroposDirectCall(
  action: RlAction,
  params: Record<string, unknown>,
): Promise<BuiltinToolResult | null> {
  const name = `anvio_tools__rl_${action}`;

  if (isAtroposMockMode()) {
    return { name, output: mockAtroposResult(action, params), status: 'completed' };
  }

  const apiUrl = process.env.ATROPOS_API_URL;
  if (!apiUrl) return null;
  const apiKey = process.env.ATROPOS_API_KEY;

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/rl/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        name,
        output: null,
        status: 'failed',
        error: `Atropos API HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const result = await res.json();
    return { name, output: { action, params, result }, status: 'completed' };
  } catch (error) {
    return {
      name,
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function rlTool(
  action: RlAction,
  params: Record<string, unknown> = {},
  mcp?: McpDelegateFn,
): Promise<BuiltinToolResult> {
  const toolName = `rl_${action}`;
  const mcpResult = await tryMcp(mcp, 'tinker-atropos', toolName, params);
  if (mcpResult) {
    mcpResult.name = `anvio_tools__${toolName}`;
    return mcpResult;
  }

  const direct = await atroposDirectCall(action, params);
  if (direct) return direct;

  return {
    name: `anvio_tools__${toolName}`,
    output: {
      action,
      params,
      note:
        'RL tools require Tinker-Atropos MCP (workspace/mcp/presets/tinker-atropos.yaml.example), ' +
        'ATROPOS_API_URL/ATROPOS_API_KEY for direct HTTP, or ANVIO_ATROPOS_MOCK=1 for local dev.',
    },
    status: 'completed',
  };
}

export { RL_ACTIONS };

const YB_ACTIONS = [
  'query_group_info',
  'query_group_members',
  'send_dm',
  'search_sticker',
  'send_sticker',
] as const;

export type YbAction = (typeof YB_ACTIONS)[number];

function isYuanbaoMockMode(): boolean {
  return process.env.ANVIO_YUANBAO_MOCK === '1';
}

/** Deterministic synthetic responses for ANVIO_YUANBAO_MOCK=1 (dev/test — no network). */
function mockYuanbaoResult(action: YbAction, params: Record<string, unknown>): Record<string, unknown> {
  switch (action) {
    case 'query_group_info':
      return { group: { id: params.groupId ?? 'mock-group', name: 'Mock Group', memberCount: 3 }, mock: true };
    case 'query_group_members':
      return { members: [{ id: 'mock-user-1', name: 'Mock User' }], mock: true };
    case 'send_dm':
      return { sent: true, to: params.userId ?? null, mock: true };
    case 'search_sticker':
      return { stickers: [{ id: 'mock-sticker-1', keyword: params.keyword ?? '' }], mock: true };
    case 'send_sticker':
      return { sent: true, stickerId: params.stickerId ?? null, mock: true };
    default:
      return { mock: true };
  }
}

/**
 * Yuanbao (Tencent messaging) group/DM/sticker ops — MCP-delegate only (no
 * documented public REST API), with `ANVIO_YUANBAO_MOCK=1` for dev/test.
 */
export async function yuanbaoTool(
  action: YbAction,
  params: Record<string, unknown> = {},
  mcp?: McpDelegateFn,
): Promise<BuiltinToolResult> {
  const toolName = `yb_${action}`;
  const mcpResult = await tryMcp(mcp, 'yuanbao', toolName, params);
  if (mcpResult) {
    mcpResult.name = `anvio_tools__${toolName}`;
    return mcpResult;
  }

  if (isYuanbaoMockMode()) {
    return { name: `anvio_tools__${toolName}`, output: mockYuanbaoResult(action, params), status: 'completed' };
  }

  return {
    name: `anvio_tools__${toolName}`,
    output: {
      action,
      params,
      note: 'Yuanbao tools require MCP preset (workspace/mcp/presets/yuanbao.yaml.example) or ANVIO_YUANBAO_MOCK=1 for local dev.',
    },
    status: 'completed',
  };
}

export { YB_ACTIONS };
