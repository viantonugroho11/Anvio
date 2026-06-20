import path from 'node:path';
import type { ChannelHubPort, SessionStore, SoulPolicy } from '@anvio/core';
import { loadSoulPolicy } from '@anvio/soul-gate';
import { ConnectionBroker, ConnectionStore } from './connect/broker.js';
import { loadHarnessConfig, loadHarnessProfiles } from './config-loader.js';
import { createHarnessGateway, HarnessGateway } from './gateway.js';

export interface CreateHarnessOptions {
  workspaceRoot: string;
  channelHub: ChannelHubPort;
  sessions: SessionStore;
  soulDefinition?: import('@anvio/core').SoulDefinition;
  onApprovalTimedOut?: (sessionId: string, requestId: string) => void | Promise<void>;
}

export async function createHarnessFromWorkspace(
  options: CreateHarnessOptions,
): Promise<HarnessGateway> {
  const defaults = await loadHarnessConfig(options.workspaceRoot);
  const profiles = await loadHarnessProfiles(options.workspaceRoot);
  const cacheDir = path.join(options.workspaceRoot, 'souls', '_cache');

  let policy: SoulPolicy;
  if (defaults.soulSlug) {
    const soulMd = path.join(options.workspaceRoot, 'souls', `${defaults.soulSlug}`, 'SOUL.md');
    try {
      policy = await loadSoulPolicy({ soulMdPath: soulMd, cacheDir, slug: defaults.soulSlug });
    } catch {
      policy = options.soulDefinition
        ? await loadSoulPolicy({ soulDefinition: options.soulDefinition, cacheDir })
        : await loadSoulPolicy({ slug: defaults.soulSlug, cacheDir });
    }
  } else if (options.soulDefinition) {
    policy = await loadSoulPolicy({ soulDefinition: options.soulDefinition, cacheDir });
  } else {
    policy = await loadSoulPolicy({ cacheDir });
  }

  let connectBroker: ConnectionBroker | undefined;
  if (defaults.connectBroker.enabled) {
    const keyEnv = defaults.connectBroker.encryptionKeyEnv;
    const key = process.env[keyEnv];
    if (key) {
      const store = new ConnectionStore(options.workspaceRoot, key);
      connectBroker = new ConnectionBroker(
        store,
        true,
        defaults.connectBroker.defaultTtlSeconds,
        options.workspaceRoot,
      );
    }
  }

  return createHarnessGateway({
    defaults,
    profiles,
    policy,
    channelHub: options.channelHub,
    sessions: options.sessions,
    connectBroker,
    onApprovalTimedOut: options.onApprovalTimedOut,
  });
}

export { HarnessGateway, createHarnessGateway } from './gateway.js';
export {
  loadHarnessConfig,
  loadHarnessProfiles,
  resolveChannelProfile,
  DEFAULT_HARNESS_YAML,
  DEFAULT_PROFILES_YAML,
} from './config-loader.js';
export { evaluateEngagement, MemoryEngagementStore } from './engagement.js';
export {
  canAccessRestrictedZone,
  isUserBlocked,
  isManagerUser,
  resolveTrustTier,
} from './policy-enforcer.js';
export {
  approverMatchesSummary,
  isAuthorizedApprover,
  resolveApproversForSummary,
} from './approver-matcher.js';
export {
  createHarnessOutputPort,
  createHarnessToolHandlers,
  harnessToolDefinitions,
} from './output-port.js';
export { formatForChannel, markdownToPlain, markdownToSlackMrkdwn } from './format/index.js';
export { SessionResumeTracker } from './session-resume.js';
export { ConnectionBroker, ConnectionStore } from './connect/broker.js';
export { startLoginHost, type LoginHostSession } from './connect/login-host.js';
export {
  createHarnessAwareToolPort,
  HarnessAwareToolPort,
  type HarnessBuiltinToolCaller,
} from './runtime-tool-port.js';
export { SimulationTransport, runSimulationScenario } from './simulation/transport.js';
