import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { HarnessChannelProfile, HarnessDefaults, HarnessProfilesConfig } from '@anvio/core';
import { parseHarnessConfig, parseHarnessProfiles } from '@anvio/core';

export const DEFAULT_HARNESS_YAML = `# Channel Harness — see docs/plans/2026-06-19-002-feat-unified-agent-product-plan.md
apiVersion: anvio.io/v1
kind: HarnessDefaults
metadata:
  name: default
spec:
  enabled: true
  soulSlug: architect-soul
  suppressRawOutput: true
  idleMinutes: 15
  resumeSessions: true
  connectBroker:
    enabled: true
    encryptionKeyEnv: ANVIO_CONNECTION_ENCRYPTION_KEY
    defaultTtlSeconds: 3600
`;

export const DEFAULT_PROFILES_YAML = `# Channel engagement profiles
apiVersion: anvio.io/v1
kind: HarnessChannelProfiles
metadata:
  name: default
spec:
  profiles:
    - name: slack-like
      channels: [slack]
      engageOn: mention
      disengageOn: mention_other
      dmPolicy: manager_only
    - name: telegram-like
      channels: [telegram]
      engageOn: mention
      disengageOn: never
      dmPolicy: anyone
    - name: discord-like
      channels: [discord]
      engageOn: mention
      disengageOn: never
      dmPolicy: anyone
    - name: web-like
      channels: [web-chat, rest]
      engageOn: always
      disengageOn: never
      dmPolicy: anyone
    - name: cli-like
      channels: [cli]
      engageOn: always
      disengageOn: never
      dmPolicy: anyone
    - name: whatsapp-like
      channels: [whatsapp]
      engageOn: always
      disengageOn: never
      dmPolicy: anyone
    - name: mattermost-like
      channels: [mattermost]
      engageOn: mention
      disengageOn: never
      dmPolicy: anyone
`;

export async function loadHarnessConfig(workspaceRoot: string): Promise<HarnessDefaults> {
  const filePath = path.join(workspaceRoot, 'harness/defaults.yaml');
  try {
    const raw = parseYaml(await fs.readFile(filePath, 'utf-8'));
    return parseHarnessConfig(raw).spec;
  } catch {
    return parseHarnessConfig(parseYaml(DEFAULT_HARNESS_YAML)).spec;
  }
}

export async function loadHarnessProfiles(workspaceRoot: string): Promise<HarnessChannelProfile[]> {
  const filePath = path.join(workspaceRoot, 'harness/channel-profiles.yaml');
  try {
    const raw = parseYaml(await fs.readFile(filePath, 'utf-8'));
    return parseHarnessProfiles(raw as HarnessProfilesConfig).spec.profiles;
  } catch {
    return parseHarnessProfiles(parseYaml(DEFAULT_PROFILES_YAML)).spec.profiles;
  }
}

export function resolveChannelProfile(
  profiles: HarnessChannelProfile[],
  channel: string,
): HarnessChannelProfile {
  const match = profiles.find((p) => p.channels.includes(channel));
  return (
    match ?? {
      name: 'default',
      channels: [channel],
      engageOn: 'always',
      disengageOn: 'never',
      dmPolicy: 'anyone',
    }
  );
}
