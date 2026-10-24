// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import { ChannelHub } from '@anvio/channels';
import type { SoulDefinition } from '@anvio/core';
import {
  ConnectionBroker,
  ConnectionStore,
  createHarnessGateway,
  loadHarnessConfig,
  loadHarnessProfiles,
  runSimulationScenario,
  startLoginHost,
} from '@anvio/harness';
import { createMemoryProvider } from '@anvio/memory';
import { createModelProviderRegistryFromEnv } from '@anvio/models';
import {
  gbrainMemoryOptions,
  parseSimulationScenario,
  prepareSimulationWorkspace,
  runSimulation,
} from '@anvio/platform';
import {
  detectSetupTokenVendor,
  runRuntimeSetupToken,
  RUNTIME_SETUP_TOKEN_VENDORS,
} from '@anvio/runtimes';
import { parseSoulMd, verifyPolicyIds } from '@anvio/soul-gate';
import { createSoulService } from '@anvio/souls';
import { Workspace } from '@anvio/workspace';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath } from '../cli-context.js';

export async function cmdSoul(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const memory = createMemoryProvider(
    workspace.config.spec.memory.provider,
    workspace.storage,
    undefined,
    gbrainMemoryOptions(workspace.config.spec.memory),
  );
  const souls = createSoulService(workspace.storage, memory);

  switch (action) {
    case 'list': {
      const items = await souls.list();
      if (items.length === 0) {
        console.log(
          'No souls found. Create one: anvio soul create --slug architect-soul --name "Architect Soul"',
        );
        return;
      }
      console.log('Souls:');
      for (const slug of items) {
        const soul = await souls.get(slug);
        console.log(`  ${slug} — ${soul.spec.name}`);
      }
      break;
    }
    case 'show': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio soul show <slug> [--context]');
        process.exit(1);
      }
      const soul = await souls.get(slug);
      if (sub.includes('--context')) {
        const ctx = await souls.loadContext(slug, workspace.config.spec.defaultUserId);
        console.log(souls.renderSoulContext(ctx));
        return;
      }
      console.log(JSON.stringify(soul, null, 2));
      break;
    }
    case 'create': {
      const slugIdx = sub.indexOf('--slug');
      const nameIdx = sub.indexOf('--name');
      const personaIdx = sub.indexOf('--from-persona');
      const slug = slugIdx >= 0 ? sub[slugIdx + 1] : undefined;
      const name = nameIdx >= 0 ? sub[nameIdx + 1] : slug;
      if (!slug || !name) {
        console.error(
          'Usage: anvio soul create --slug <slug> --name <name> [--from-persona <persona>]',
        );
        process.exit(1);
      }

      let definition: SoulDefinition = {
        apiVersion: 'anvio.io/v1',
        kind: 'Soul',
        metadata: { slug, version: '1.0.0' },
        spec: {
          name,
          identity: {},
          values: [],
          personality: [],
          preferences: {},
          communicationStyle: { tone: 'professional', format: 'clear and concise' },
          longTermGoals: [],
          behavioralTendencies: [],
          relationshipMemory: { provider: 'filesystem', path: 'relationship' },
          evolution: { allowAutoUpdate: true, requireApproval: true, captureOn: 'always' },
        },
      };

      if (personaIdx >= 0) {
        const personaSlug = sub[personaIdx + 1];
        const persona = await workspace.loader.loadPersona(personaSlug);
        definition = {
          ...definition,
          spec: {
            ...definition.spec,
            name: persona.name ?? name,
            personality: persona.behavior ?? [],
            communicationStyle: {
              tone: persona.tone,
              format: persona.communicationStyle,
            },
            behavioralTendencies: persona.behavior ?? [],
          },
        };
      }

      const saved = await souls.create(definition);
      console.log(`Soul created: ${saved.metadata.slug}`);
      break;
    }
    case 'import': {
      const file = sub[1];
      const slugIdx = sub.indexOf('--slug');
      const slug = slugIdx >= 0 ? sub[slugIdx + 1] : 'architect-soul';
      const useLlm = sub.includes('--llm');
      if (!file) {
        console.error('Usage: anvio soul import <SOUL.md> [--slug <slug>] [--llm]');
        process.exit(1);
      }
      const source = await fs.readFile(path.resolve(file), 'utf-8');
      const policy = parseSoulMd(source, slug);
      const soulDir = path.join(wsPath, 'souls', slug);
      await fs.mkdir(soulDir, { recursive: true });
      await fs.writeFile(path.join(soulDir, 'SOUL.md'), source, 'utf-8');
      const cacheDir = path.join(wsPath, 'souls', '_cache');
      await fs.mkdir(cacheDir, { recursive: true });

      let identity: unknown;
      if (useLlm) {
        const providerMap = createModelProviderRegistryFromEnv();
        const modelProvider = providerMap.get('anthropic') ?? providerMap.values().next().value;
        const definition = await souls.importFromMarkdown(source, slug, {
          modelProvider,
          save: false,
        });
        identity = definition.spec;
        console.log(
          `LLM soul-data extraction: ${modelProvider ? modelProvider.providerId : 'regex-only'}`,
        );
      }

      console.log(
        JSON.stringify(identity ? { slug, policy, identity } : { slug, policy }, null, 2),
      );
      console.log(`Imported SOUL.md → workspace/souls/${slug}/SOUL.md`);
      break;
    }
    case 'validate-policy': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio soul validate-policy <SOUL.md>');
        process.exit(1);
      }
      const source = await fs.readFile(path.resolve(file), 'utf-8');
      const policy = verifyPolicyIds(source, parseSoulMd(source));
      console.log(JSON.stringify(policy, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio soul list|show|create|import|validate-policy');
      process.exit(1);
  }
}

export async function openConnectBroker(sub: string[]) {
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const defaults = await loadHarnessConfig(wsPath);
  const keyEnv = defaults.connectBroker.encryptionKeyEnv;
  const key = process.env[keyEnv];

  if (!defaults.connectBroker.enabled) {
    console.error(
      'Connect broker disabled — enable connectBroker in workspace/harness/defaults.yaml',
    );
    process.exit(1);
  }
  if (!key) {
    console.error(`Set ${keyEnv} to use contextual connections`);
    process.exit(1);
  }

  const store = new ConnectionStore(wsPath, key);
  const broker = new ConnectionBroker(
    store,
    true,
    defaults.connectBroker.defaultTtlSeconds,
    wsPath,
  );
  const flag = (name: string) => {
    const i = sub.indexOf(name);
    return i >= 0 ? sub[i + 1] : undefined;
  };

  return { workspace, broker, flag };
}

export async function cmdSetupToken(sub: string[]) {
  if (sub.includes('--list')) {
    console.log('Supported runtime vendors:');
    for (const vendor of RUNTIME_SETUP_TOKEN_VENDORS) {
      console.log(`  --${vendor}`);
    }
    return;
  }

  const vendor = detectSetupTokenVendor(sub);
  if (!vendor) {
    console.error(
      'Usage: anvio setup-token --claude|--cursor|--codex|--antigravity|--nous [--token TOKEN] [--binary NAME] [--no-install] [--list]',
    );
    process.exit(1);
  }

  const { workspace, broker, flag } = await openConnectBroker(sub);
  const explicitToken = flag('--token');
  const binary = flag('--binary');
  const autoInstall = !sub.includes('--no-install');
  const threadId = flag('--thread') ?? 'default';
  const channel = flag('--channel') ?? 'cli';
  const userId = flag('--user') ?? workspace.config.spec.defaultUserId;

  console.log(`Running official ${vendor} login flow…`);
  try {
    const result = await runRuntimeSetupToken(vendor, {
      explicitToken,
      binary,
      autoInstall,
      onAuthorizeUrl: (url) => {
        console.log(`Open this URL to complete Nous Portal 1-click login:\n  ${url}`);
        console.log('Waiting for callback…');
      },
    });
    const stored = await broker.putConnection({
      channel,
      userId,
      service: result.service,
      threadId,
      payload: result.payload,
      ttlSeconds: 365 * 24 * 3600,
    });
    console.log(result.message);
    console.log(JSON.stringify(stored, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function cmdConnect(sub: string[]) {
  const action = sub[0] ?? 'list';
  const { workspace, broker, flag } = await openConnectBroker(sub);
  switch (action) {
    case 'list': {
      const userId = flag('--user') ?? workspace.config.spec.defaultUserId;
      const items = await broker.listConnections(userId);
      if (items.length === 0) {
        console.log('No connections stored.');
        return;
      }
      for (const item of items) {
        console.log(
          `  ${item.service} (${item.channel}) user=${item.userId} threads=${item.threadIds.join(',')}`,
        );
      }
      break;
    }
    case 'put': {
      const service = flag('--service');
      const payload = flag('--payload');
      const threadId = flag('--thread') ?? 'default';
      const channel = flag('--channel') ?? 'cli';
      const userId = flag('--user') ?? workspace.config.spec.defaultUserId;
      if (!service || !payload) {
        console.error(
          'Usage: anvio connect put --service NAME --payload JSON [--thread ID] [--channel cli]',
        );
        process.exit(1);
      }
      const stored = await broker.putConnection({
        channel,
        userId,
        service,
        payload,
        threadId,
      });
      console.log(JSON.stringify(stored, null, 2));
      break;
    }
    case 'revoke': {
      const service = flag('--service');
      const channel = flag('--channel') ?? 'cli';
      const userId = flag('--user') ?? workspace.config.spec.defaultUserId;
      if (!service) {
        console.error('Usage: anvio connect revoke --service NAME [--channel cli]');
        process.exit(1);
      }
      const ok = await broker.revokeConnection(channel, userId, service);
      console.log(ok ? 'Revoked.' : 'Not found.');
      break;
    }
    case 'login': {
      const target = sub[1];
      if (target === 'claude-code' || target === 'claude') {
        console.log('Tip: prefer `anvio setup-token --claude`');
        await cmdSetupToken(['--claude', ...sub.slice(2)]);
        break;
      }
      console.error('Usage: anvio connect login claude-code  (prefer: anvio setup-token --claude)');
      process.exit(1);
      break;
    }
    case 'login-host': {
      const port = Number(flag('--port') ?? '9876');
      const service = flag('--service') ?? 'oauth';
      const threadId = flag('--thread') ?? 'default';
      const channel = flag('--channel') ?? 'cli';
      const userId = flag('--user') ?? workspace.config.spec.defaultUserId;
      const host = await startLoginHost({ port, timeoutMs: 300_000 });
      console.log(`Login host listening — set OAuth redirect_uri to:\n  ${host.callbackUrl}`);
      console.log('Waiting for callback…');
      const query = await host.waitForCallback();
      const stored = await broker.putConnection({
        channel,
        userId,
        service,
        threadId,
        payload: JSON.stringify(query),
      });
      await host.close();
      console.log(JSON.stringify(stored, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio connect list|put|revoke|login claude-code|login-host');
      process.exit(1);
  }
}

export async function cmdHarness(sub: string[]) {
  const action = sub[0] ?? 'status';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const defaults = await loadHarnessConfig(wsPath);
  const profiles = await loadHarnessProfiles(wsPath);

  switch (action) {
    case 'status': {
      console.log('Channel Harness');
      console.log(`  enabled: ${defaults.enabled}`);
      console.log(`  soulSlug: ${defaults.soulSlug ?? '(none)'}`);
      console.log(`  suppressRawOutput: ${defaults.suppressRawOutput}`);
      console.log(`  idleMinutes: ${defaults.idleMinutes}`);
      console.log(`  profiles: ${profiles.map((p) => p.name).join(', ')}`);
      console.log(`  connectBroker: ${defaults.connectBroker.enabled ? 'enabled' : 'disabled'}`);
      break;
    }
    case 'simulate': {
      const scenarioIdx = sub.indexOf('--scenario');
      if (scenarioIdx >= 0) {
        // ADR 0033: full-turn scenario against a disposable copy of this workspace.
        const files = sub.slice(scenarioIdx + 1).filter((a) => !a.startsWith('--'));
        if (files.length === 0) {
          console.error('Usage: anvio harness simulate --scenario <file.scenario.yaml> [...]');
          process.exitCode = 1;
          break;
        }
        let failed = 0;
        for (const file of files) {
          const scenario = parseSimulationScenario(await fs.readFile(file, 'utf-8'));
          const simWorkspace = await prepareSimulationWorkspace(wsPath);
          try {
            const result = await runSimulation(scenario, { workspacePath: simWorkspace });
            console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name}`);
            for (const failure of result.failures) console.log(`      ${failure}`);
            if (!result.passed) failed++;
          } finally {
            await fs.rm(simWorkspace, { recursive: true, force: true });
          }
        }
        // A simulated platform leaves timers (automation, idle tracking) running; this is a
        // one-shot command, so exit explicitly instead of waiting for the loop to drain.
        process.exit(failed > 0 ? 1 : 0);
      }
      const hub = new ChannelHub();
      const harness = createHarnessGateway({
        defaults: { ...defaults, enabled: true },
        profiles,
        policy: parseSoulMd(
          `## Identity
- Name: Test Agent
## Reporting
- Manager: U_MANAGER
## Mandate
- Help the team ship safely.
## Approvers
- <@U_MANAGER>: anything ; catchall
## Blocked
- <@U_BLOCKED>
`,
          'test',
        ),
        channelHub: hub,
        sessions: workspace.sessions,
      });
      const results = await runSimulationScenario(harness, [
        {
          channel: 'slack',
          threadId: 'T1',
          userId: 'U_BLOCKED',
          content: 'hello',
          zoneId: 'C_PUBLIC',
        },
        {
          channel: 'slack',
          threadId: 'T2',
          userId: 'U_MANAGER',
          content: 'hello',
          zoneId: 'C_PUBLIC',
          mentionedBot: true,
        },
      ]);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio harness status|simulate');
      process.exit(1);
  }
}
