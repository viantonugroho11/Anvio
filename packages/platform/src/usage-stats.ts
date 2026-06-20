import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider, TokenUsage } from '@anvio/core';

export interface TokenUsageRecord {
  ts: string;
  sessionId: string;
  channel: string;
  agentId?: string;
  userId?: string;
  provider?: string;
  model?: string;
  usage: TokenUsage;
  estimatedCostUsd?: number;
}

export interface TokenUsageStats {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byAgent: Record<string, { totalTokens: number; estimatedCostUsd: number }>;
  byChannel: Record<string, { totalTokens: number; estimatedCostUsd: number }>;
}

const AUDIT_PATH = 'audit/tokens.jsonl';

export async function readTokenUsageAudit(storage: StorageProvider): Promise<TokenUsageRecord[]> {
  const root = (storage as { rootPath?: string }).rootPath;
  let raw: string | null;
  if (root) {
    try {
      raw = await fs.readFile(path.join(root, AUDIT_PATH), 'utf-8');
    } catch {
      return [];
    }
  } else {
    raw = await storage.read(AUDIT_PATH);
  }
  if (!raw?.trim()) return [];

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TokenUsageRecord);
}

function parseSinceHours(last?: string): number | undefined {
  if (!last) return undefined;
  const match = /^(\d+)\s*h$/i.exec(last.trim());
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

export function aggregateTokenUsage(
  records: TokenUsageRecord[],
  options: { sinceHours?: number; agentId?: string; channel?: string } = {},
): TokenUsageStats {
  const cutoff =
    options.sinceHours != null
      ? Date.now() - options.sinceHours * 60 * 60 * 1000
      : undefined;

  const filtered = records.filter((record) => {
    if (cutoff != null && Date.parse(record.ts) < cutoff) return false;
    if (options.agentId && record.agentId !== options.agentId) return false;
    if (options.channel && record.channel !== options.channel) return false;
    return true;
  });

  const stats: TokenUsageStats = {
    runs: filtered.length,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    byAgent: {},
    byChannel: {},
  };

  for (const record of filtered) {
    stats.inputTokens += record.usage.inputTokens;
    stats.outputTokens += record.usage.outputTokens;
    stats.totalTokens += record.usage.totalTokens;
    stats.estimatedCostUsd += record.estimatedCostUsd ?? 0;

    const agentKey = record.agentId ?? 'unknown';
    stats.byAgent[agentKey] ??= { totalTokens: 0, estimatedCostUsd: 0 };
    stats.byAgent[agentKey].totalTokens += record.usage.totalTokens;
    stats.byAgent[agentKey].estimatedCostUsd += record.estimatedCostUsd ?? 0;

    const channelKey = record.channel ?? 'unknown';
    stats.byChannel[channelKey] ??= { totalTokens: 0, estimatedCostUsd: 0 };
    stats.byChannel[channelKey].totalTokens += record.usage.totalTokens;
    stats.byChannel[channelKey].estimatedCostUsd += record.estimatedCostUsd ?? 0;
  }

  stats.estimatedCostUsd = Math.round(stats.estimatedCostUsd * 1_000_000) / 1_000_000;
  return stats;
}

export function parseUsageLastFlag(args: string[]): number | undefined {
  const idx = args.indexOf('--last');
  if (idx < 0 || !args[idx + 1]) return undefined;
  return parseSinceHours(args[idx + 1]);
}
