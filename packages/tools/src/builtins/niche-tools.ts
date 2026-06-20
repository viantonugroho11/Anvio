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

export async function videoAnalyze(
  videoUrlOrPath: string,
  prompt = 'Summarize this video content.',
): Promise<BuiltinToolResult> {
  if (videoUrlOrPath.startsWith('http://') || videoUrlOrPath.startsWith('https://')) {
    return {
      name: 'anvio_tools__video_analyze',
      output: {
        videoUrlOrPath,
        note: 'Remote video analysis requires ffmpeg frame extraction or MCP video server. Use vision_analyze on a screenshot/frame URL.',
        prompt,
      },
      status: 'completed',
    };
  }
  return visionAnalyze(videoUrlOrPath, prompt);
}

export async function videoGenerate(prompt: string): Promise<BuiltinToolResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      name: 'anvio_tools__video_generate',
      output: { prompt, note: 'Video generation not configured — use MCP video_gen server or external provider' },
      status: 'completed',
    };
  }
  return {
    name: 'anvio_tools__video_generate',
    output: {
      prompt,
      note: 'OpenAI video API not wired — enable MCP preset workspace/mcp/presets/video-gen.yaml.example',
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
  return {
    name: `anvio_tools__${toolName}`,
    output: {
      action,
      params,
      note: 'RL tools require Tinker-Atropos MCP — see workspace/mcp/presets/tinker-atropos.yaml.example',
    },
    status: 'completed',
  };
}

export { RL_ACTIONS };
