import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSimulationScenario, prepareSimulationWorkspace, runSimulation } from '@anvio/platform';

const repoRoot = path.resolve(__dirname, '../..');
const scenarioDir = path.join(repoRoot, 'tests/simulation');

describe('ADR 0033 — end-to-end gateway simulation', () => {
  const workspaces: string[] = [];
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((w) => fs.rm(w, { recursive: true, force: true })));
  });

  it.each(['mention-engages.scenario.yaml', 'approval-gate.scenario.yaml'])('%s', async (file) => {
    const scenario = parseSimulationScenario(await fs.readFile(path.join(scenarioDir, file), 'utf-8'));
    const workspacePath = await prepareSimulationWorkspace(path.join(repoRoot, 'workspace'));
    workspaces.push(workspacePath);
    const result = await runSimulation(scenario, { workspacePath });
    expect(result.failures, JSON.stringify(result.outbox, null, 2)).toEqual([]);
  }, 30_000);
});
