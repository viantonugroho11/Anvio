import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { parseAutomationDefinition, parseBlueprintDefinition } from '@anvio/core';
import { ActionExecutor, AutomationRegistry } from '@anvio/automation';
import { BlueprintExecutor, createCatalogRegistry, renderTemplate } from '@anvio/blueprints';
import { createHookEngine } from '@anvio/hooks';
import { LocalEventBus, EventSubjects } from '@anvio/events';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { parse as parseYaml } from 'yaml';

describe('Phase B — Automation, Blueprints, Hooks', () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-phase-b-'));
    await Workspace.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('renders blueprint templates with step outputs', () => {
    const output = renderTemplate('# Summary\n{{steps.gather.output}}', {
      inputs: { userId: 'local-user' },
      steps: { gather: { output: 'Hello world' } },
      date: '2026-06-19',
    });
    expect(output).toContain('Hello world');
  });

  it('validates bundled blueprints', async () => {
    const catalog = createCatalogRegistry(tmpDir, repoRoot);
    const bundled = await catalog.listBundled();
    expect(bundled.length).toBeGreaterThanOrEqual(8);

    for (const slug of bundled) {
      const bp = await catalog.load(slug);
      expect(bp.metadata.slug).toBe(slug);
    }
  });

  it('executes blueprint in dry-run mode', async () => {
    const catalog = createCatalogRegistry(tmpDir, repoRoot);
    const executor = new BlueprintExecutor({ catalog });
    const result = await executor.run('daily-summary', { userId: 'local-user' }, { dryRun: true });
    expect(result.status).toBe('dry_run');
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('loads automation from workspace filesystem', async () => {
    const storage = new FilesystemStorageProvider(tmpDir);
    await storage.write(
      'automations/test-auto.yaml',
      `apiVersion: anvio.io/v1
kind: Automation
metadata:
  slug: test-auto
  enabled: true
spec:
  description: Test
  trigger:
    type: event
    event: anvio.goal.completed.v1
  action:
    type: blueprint
    blueprint: daily-summary
    inputs:
      userId: local-user`,
    );

    const registry = new AutomationRegistry(storage);
    const items = await registry.loadAll();
    expect(items).toHaveLength(1);
    expect(items[0].metadata.slug).toBe('test-auto');
  });

  it('dispatches hook on goal created event', async () => {
    const scriptPath = path.join(tmpDir, 'hooks/test-hook.sh');
    await fs.mkdir(path.join(tmpDir, 'hooks'), { recursive: true });
    await fs.writeFile(
      scriptPath,
      `#!/bin/bash\npayload=$(cat)\necho "$payload" >> "${tmpDir}/audit/hook.log"\n`,
      'utf-8',
    );
    await fs.chmod(scriptPath, 0o755);
    await fs.mkdir(path.join(tmpDir, 'audit'), { recursive: true });

    await fs.writeFile(
      path.join(tmpDir, 'hooks/hooks.yaml'),
      `apiVersion: anvio.io/v1
kind: HookRegistry
spec:
  hooks:
    - event: onGoalCreated
      handlers:
        - type: script
          path: hooks/test-hook.sh
          timeoutMs: 5000`,
    );

    const bus = new LocalEventBus('/test');
    const hooks = createHookEngine(tmpDir, bus);
    await hooks.start();

    await bus.publishCore(EventSubjects.GOAL_CREATED, 'anvio.goal.created', {
      goalSlug: 'test-goal',
      title: 'Test',
    });

    await new Promise((r) => setTimeout(r, 200));
    const log = await fs.readFile(path.join(tmpDir, 'audit/hook.log'), 'utf-8');
    expect(log).toContain('test-goal');
    await hooks.stop();
  });

  it('parses automation and blueprint schemas', () => {
    const automation = parseAutomationDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Automation',
      metadata: { slug: 'x', enabled: true },
      spec: {
        trigger: { type: 'cron', schedule: '0 8 * * *' },
        action: { type: 'agent', agent: 'architect', input: 'hi' },
      },
    });
    expect(automation.spec.trigger.type).toBe('cron');

    const blueprint = parseBlueprintDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Blueprint',
      metadata: { slug: 'bp' },
      spec: { steps: [{ id: 's1', type: 'transform', template: 'ok' }] },
    });
    expect(blueprint.spec.steps[0].type).toBe('transform');
  });

  it('action executor runs blueprint action', async () => {
    const catalog = createCatalogRegistry(tmpDir, repoRoot);
    const blueprintExecutor = new BlueprintExecutor({ catalog });
    const actionExecutor = new ActionExecutor({ blueprintExecutor });

    const storage = new FilesystemStorageProvider(tmpDir);
    await storage.write(
      'automations/bp-run.yaml',
      `apiVersion: anvio.io/v1
kind: Automation
metadata:
  slug: bp-run
  enabled: true
spec:
  trigger:
    type: cron
    schedule: "0 8 * * *"
  action:
    type: blueprint
    blueprint: research-report
    inputs:
      topic: AI agents`,
    );

    const automation = parseAutomationDefinition(parseYaml(await storage.read('automations/bp-run.yaml')!));
    const result = await actionExecutor.execute(automation, { userId: 'local-user' });
    expect(result.status).toBe('completed');
  });
});
