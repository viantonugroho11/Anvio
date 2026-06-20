import type { SoulDefinition, SoulPolicy } from '@anvio/core';
import type { ModelProvider } from '@anvio/core';
import { defaultSoulPolicy, parseSoulPolicy } from '@anvio/core';
import { extractIdsFromLine, parseApproversSection, verifyPolicyIds } from './verifier.js';
import { hashSoulSource, readCachedPolicy, writeCachedPolicy } from './policy-cache.js';
import { extractSoulPolicy } from './soul-policy-llm.js';

function sectionLines(source: string, heading: string): string[] {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(source);
  if (!match) return [];
  const rest = source.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const body = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return body.split('\n');
}

function bulletValues(lines: string[]): string[] {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-\s*/, '').replace(/;.*$/, '').trim())
    .filter(Boolean);
}

function fieldValue(lines: string[], label: string): string | undefined {
  const re = new RegExp(`^[-*]?\\s*${label}\\s*[:\\-]\\s*(.+)$`, 'i');
  for (const line of lines) {
    const m = re.exec(line.trim());
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** Regex-first SOUL.md parser (LLM extraction deferred to Phase H). */
export function parseSoulMd(source: string, slug?: string): SoulPolicy {
  const identityLines = sectionLines(source, 'Identity');
  const reportingLines = sectionLines(source, 'Reporting');
  const allowedLines = sectionLines(source, 'Allowed channels');
  const trustedLines = sectionLines(source, 'Trusted channels');
  const blockedLines = sectionLines(source, 'Blocked');
  const approverLines = sectionLines(source, 'Approvers');
  const redactLines = sectionLines(source, 'Redaction');
  const timeoutLine = fieldValue(sectionLines(source, 'Approval timeout'), 'seconds') ??
    fieldValue(sectionLines(source, 'Approval timeout'), '');

  const managerId = fieldValue(reportingLines, 'Manager') ?? extractIdsFromLine(reportingLines.join('\n'))[0];
  const backupId =
    fieldValue(reportingLines, 'Backup manager') ??
    extractIdsFromLine(reportingLines.join('\n')).find((id) => id !== managerId);

  const draft = parseSoulPolicy({
    soulSlug: slug,
    identity: {
      name: fieldValue(identityLines, 'Name') ?? 'Agent',
      role: fieldValue(identityLines, 'Role'),
      voice: fieldValue(identityLines, 'Voice'),
    },
    manager: managerId ? { channel: '*', userId: managerId } : undefined,
    backupManager: backupId ? { channel: '*', userId: backupId } : undefined,
    allowedZones: allowedLines.length
      ? [{ channel: '*', ids: extractIdsFromLine(allowedLines.join('\n')) }]
      : [],
    trustedZones: trustedLines.length
      ? [{ channel: '*', ids: extractIdsFromLine(trustedLines.join('\n')) }]
      : [],
    blockedUsers: blockedLines.flatMap((line) =>
      extractIdsFromLine(line).map((userId) => ({ channel: '*', userId })),
    ),
    approvers: parseApproversSection(approverLines),
    redactPatterns: bulletValues(redactLines),
    approvalTimeoutSeconds: timeoutLine ? Number.parseInt(timeoutLine, 10) || 0 : 0,
    mandate: sectionLines(source, 'Mandate').join('\n').trim(),
    values: bulletValues(sectionLines(source, 'Values')),
  });

  return verifyPolicyIds(source, draft);
}

export function policyFromSoulDefinition(definition: SoulDefinition): SoulPolicy {
  const { spec, metadata } = definition;
  const ext = spec.extensions as Record<string, unknown> | undefined;
  const policyExt = ext?.policy as Partial<SoulPolicy> | undefined;

  if (policyExt) {
    return parseSoulPolicy({
      soulSlug: metadata.slug,
      identity: {
        name: spec.name,
        role: spec.identity.role,
        voice: spec.communicationStyle.tone,
      },
      mandate: spec.longTermGoals.join('; ') || 'Assist users within configured boundaries.',
      values: spec.values,
      ...policyExt,
    });
  }

  return parseSoulPolicy({
    soulSlug: metadata.slug,
    identity: {
      name: spec.name,
      role: spec.identity.role,
      voice: spec.communicationStyle.tone,
    },
    mandate: spec.longTermGoals.join('; ') || 'Assist users within configured boundaries.',
    values: spec.values,
  });
}

export async function loadSoulPolicy(options: {
  soulMdPath?: string;
  soulDefinition?: SoulDefinition;
  cacheDir: string;
  slug?: string;
  modelProvider?: ModelProvider;
  useLlmExtraction?: boolean;
}): Promise<SoulPolicy> {
  if (options.soulMdPath) {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(options.soulMdPath, 'utf-8');
    const hash = hashSoulSource(source);
    const cached = await readCachedPolicy(options.cacheDir, hash);
    if (cached) return cached;
    const policy =
      options.useLlmExtraction !== false
        ? await extractSoulPolicy(source, options.slug, options.modelProvider)
        : parseSoulMd(source, options.slug);
    await writeCachedPolicy(options.cacheDir, hash, policy);
    return policy;
  }
  if (options.soulDefinition) {
    return policyFromSoulDefinition(options.soulDefinition);
  }
  return defaultSoulPolicy(options.slug);
}
