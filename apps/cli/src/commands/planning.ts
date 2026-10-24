// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import { nextCronRuns, PlanExecuteReviewEngine } from '@anvio/automation';
import { createBatchEngine } from '@anvio/batch';
import { BlueprintExecutor, createCatalogRegistry } from '@anvio/blueprints';
import type { GoalStatus } from '@anvio/core';
import { EventSubjects } from '@anvio/events';
import { createGoalEngine } from '@anvio/goals';
import { createKanbanEngine } from '@anvio/kanban';
import { findRepoRoot, loadAgent, storedSessionToRuntime } from '@anvio/platform';
import { FilesystemStorageProvider } from '@anvio/storage';
import { createWorkflowRegistry, DagExecutor } from '@anvio/workflows';
import { Workspace } from '@anvio/workspace';
import path from 'node:path';
import { getPlatform, resolveWorkspacePath } from '../cli-context.js';

export async function cmdGoal(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const goals = createGoalEngine(workspace.storage);

  switch (action) {
    case 'list': {
      const statusArg = sub.indexOf('--status');
      const status = statusArg >= 0 ? (sub[statusArg + 1] as GoalStatus) : undefined;
      const items = await goals.list(status);
      if (items.length === 0) {
        console.log(
          'No goals found. Create one: anvio goal create --slug my-goal --title "My Goal"',
        );
        return;
      }
      console.log('Goals:');
      for (const goal of items) {
        console.log(
          `  ${goal.metadata.slug} [${goal.spec.status}] ${goal.spec.priority} — ${goal.spec.title} (${goal.spec.progress.percent}%)`,
        );
      }
      break;
    }
    case 'create': {
      const slugIdx = sub.indexOf('--slug');
      const titleIdx = sub.indexOf('--title');
      const slug = slugIdx >= 0 ? sub[slugIdx + 1] : undefined;
      const title = titleIdx >= 0 ? sub[titleIdx + 1] : undefined;
      if (!slug || !title) {
        console.error('Usage: anvio goal create --slug <slug> --title <title>');
        process.exit(1);
      }
      const goal = await goals.create({ slug, spec: { title, description: '' } });
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(EventSubjects.GOAL_CREATED, 'anvio.goal.created', {
          goalSlug: slug,
          title,
        });
      } catch {
        // Event bus optional for offline goal creation
      }
      console.log(`Goal created: ${goal.metadata.slug}`);
      break;
    }
    case 'progress': {
      const slug = sub[1];
      const percentIdx = sub.indexOf('--percent');
      const percent = percentIdx >= 0 ? Number(sub[percentIdx + 1]) : undefined;
      if (!slug || percent == null || Number.isNaN(percent)) {
        console.error('Usage: anvio goal progress <slug> --percent <0-100>');
        process.exit(1);
      }
      const goal = await goals.updateProgress(slug, { percent });
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(
          EventSubjects.GOAL_PROGRESS_UPDATED,
          'anvio.goal.progress.updated',
          { goalSlug: slug, percent: goal.spec.progress.percent },
        );
      } catch {
        // Event bus optional
      }
      console.log(`Goal ${slug} progress: ${goal.spec.progress.percent}%`);
      break;
    }
    case 'complete': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal complete <slug>');
        process.exit(1);
      }
      const goal = await goals.complete(slug);
      try {
        const platform = await getPlatform();
        await platform.eventBus.publish(EventSubjects.GOAL_COMPLETED, 'anvio.goal.completed', {
          goalSlug: slug,
        });
      } catch {
        // Event bus optional
      }
      console.log(`Goal completed: ${goal.metadata.slug}`);
      break;
    }
    case 'pause': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal pause <slug>');
        process.exit(1);
      }
      await goals.pause(slug);
      console.log(`Goal paused: ${slug}`);
      break;
    }
    case 'resume': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio goal resume <slug>');
        process.exit(1);
      }
      await goals.resume(slug);
      console.log(`Goal resumed: ${slug}`);
      break;
    }
    default:
      console.error('Usage: anvio goal list|create|progress|complete|pause|resume');
      process.exit(1);
  }
}

export async function cmdBlueprint(sub: string[]) {
  const action = sub[0] ?? 'catalog';
  const wsPath = resolveWorkspacePath();
  const catalog = createCatalogRegistry(wsPath, findRepoRoot(wsPath));

  switch (action) {
    case 'catalog': {
      const items = await catalog.listAll();
      if (items.length === 0) {
        console.log('No blueprints found.');
        return;
      }
      for (const item of items) {
        const bp = await catalog.load(item.slug);
        console.log(`  ${item.slug} [${item.source}] — ${bp.spec.description}`);
      }
      break;
    }
    case 'install': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio blueprint install <slug>');
        process.exit(1);
      }
      await catalog.install(slug);
      console.log(`Installed blueprint: ${slug}`);
      break;
    }
    case 'validate': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio blueprint validate <file.yaml>');
        process.exit(1);
      }
      const bp = await catalog.validateFile(path.resolve(file));
      console.log(`Valid: ${bp.metadata.slug}`);
      break;
    }
    case 'run': {
      const slug = sub[1];
      const dryRun = sub.includes('--dry-run');
      if (!slug) {
        console.error('Usage: anvio blueprint run <slug> [--dry-run] [key=value ...]');
        process.exit(1);
      }
      const inputs: Record<string, unknown> = {};
      for (const arg of sub.slice(2)) {
        if (arg.startsWith('--')) continue;
        const [k, v] = arg.split('=');
        if (k && v) inputs[k] = v;
      }
      const executor = new BlueprintExecutor({ catalog });
      const result = await executor.run(slug, inputs, { dryRun });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio blueprint catalog|install|run|validate');
      process.exit(1);
  }
}

export async function loadPlannerEngine(wsPath: string): Promise<PlanExecuteReviewEngine | null> {
  const fromWorkspace = await PlanExecuteReviewEngine.loadFromWorkspace(wsPath);
  if (fromWorkspace) return fromWorkspace;
  try {
    const repoRoot = findRepoRoot(wsPath);
    if (!repoRoot) return null;
    return await PlanExecuteReviewEngine.load(
      path.join(repoRoot, 'configs/planner/plan-execute-review.yaml'),
    );
  } catch {
    return null;
  }
}

export async function cmdPlanner(sub: string[]) {
  const action = sub[0] ?? 'run';
  const jsonOut = sub.includes('--json');
  const wsPath = resolveWorkspacePath();

  switch (action) {
    case 'phases': {
      const engine = await loadPlannerEngine(wsPath);
      if (!engine) {
        console.error(
          'Planner config not found. Copy configs/planner/plan-execute-review.yaml to workspace/planner/',
        );
        process.exit(1);
      }
      for (const phase of engine.phases) {
        console.log(`${phase.name}\t${phase.agent}`);
      }
      break;
    }
    case 'run': {
      const task = sub
        .filter((a) => a !== '--json' && a !== 'run')
        .join(' ')
        .trim();
      if (!task) {
        console.error('Usage: anvio planner run <task description> [--json]');
        process.exit(1);
      }
      const engine = await loadPlannerEngine(wsPath);
      if (!engine) {
        console.error('Planner config not found.');
        process.exit(1);
      }
      const platform = await getPlatform();
      const { workspace, runtime, auth } = platform;
      const ctx = auth.getDefaultContext();
      const runner = {
        runAgent: async (agentId: string, prompt: string): Promise<string> => {
          const agent = await loadAgent(workspace, agentId);
          const stored = await workspace.sessions.create({
            userId: ctx.userId,
            agentName: agentId,
            channel: 'cli',
            messages: [],
            status: 'idle',
          });
          const session = storedSessionToRuntime(stored);
          let full = '';
          for await (const chunk of runtime.stream(session, agent, { content: prompt })) {
            if (chunk.type === 'chunk' && chunk.delta) full += chunk.delta;
            if (chunk.type === 'error') throw new Error(chunk.error ?? 'Agent run failed');
          }
          return full;
        },
      };
      console.log(`\n📋 Planner: ${engine.phases.map((p) => p.name).join(' → ')}\n`);
      const results = await engine.run(runner, { task });
      if (jsonOut) {
        console.log(JSON.stringify(results, null, 2));
        break;
      }
      for (const result of results) {
        console.log(`\n=== ${result.phase.toUpperCase()} (${result.agent}) ===\n`);
        console.log(result.output);
      }
      break;
    }
    default:
      console.error('Usage: anvio planner phases|run <task> [--json]');
      process.exit(1);
  }
}

export async function cmdAutomation(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();

  switch (action) {
    case 'list': {
      const items = await platform.automationEngine.list();
      if (items.length === 0) {
        console.log('No automations in workspace/automations/');
        return;
      }
      for (const a of items) {
        console.log(
          `  ${a.metadata.slug} [${a.metadata.enabled ? 'enabled' : 'disabled'}] — ${a.spec.description}`,
        );
      }
      break;
    }
    case 'run': {
      const slug = sub[1];
      const force = sub.includes('--force');
      if (!slug) {
        console.error('Usage: anvio automation run <slug> [--force]');
        process.exit(1);
      }
      await platform.automationEngine.run(slug, force);
      console.log(`Automation executed: ${slug}`);
      break;
    }
    default:
      console.error('Usage: anvio automation list|run');
      process.exit(1);
  }
}

export async function cmdCron(sub: string[]) {
  const action = sub[0] ?? 'list';
  const platform = await getPlatform();
  const scheduler = platform.automationEngine.getCronScheduler();

  switch (action) {
    case 'list': {
      const items = scheduler.listCronAutomations();
      if (items.length === 0) {
        console.log('No cron automations configured.');
        return;
      }
      for (const a of items) {
        const trigger = a.spec.trigger;
        if (trigger.type !== 'cron') continue;
        console.log(`  ${a.metadata.slug} — ${trigger.schedule} (${trigger.timezone})`);
      }
      break;
    }
    case 'next-runs': {
      const limitIdx = sub.indexOf('--limit');
      const limit = limitIdx >= 0 ? Number(sub[limitIdx + 1]) : 5;
      const items = scheduler.listCronAutomations();
      for (const a of items) {
        const trigger = a.spec.trigger;
        if (trigger.type !== 'cron') continue;
        const runs = nextCronRuns(trigger.schedule, new Date(), limit);
        console.log(`${a.metadata.slug}:`);
        for (const run of runs) console.log(`  ${run.toISOString()}`);
      }
      break;
    }
    default:
      console.error('Usage: anvio cron list|next-runs [--limit N]');
      process.exit(1);
  }
}

export async function cmdHooks(sub: string[]) {
  const action = sub[0] ?? 'test';
  const wsPath = resolveWorkspacePath();
  const platform = await getPlatform();

  if (action === 'test') {
    const event = sub[1] as import('@anvio/core').HookEventName | undefined;
    if (!event) {
      console.error('Usage: anvio hooks test <onSessionStart|onGoalCreated|...>');
      process.exit(1);
    }
    await platform.hookEngine.test(event, { test: true, workspace: wsPath });
    console.log(`Hook test dispatched: ${event}`);
    return;
  }

  console.error('Usage: anvio hooks test <event>');
  process.exit(1);
}

export async function cmdKanban(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const kanban = createKanbanEngine({ storage });

  switch (action) {
    case 'list': {
      const columnIdx = sub.indexOf('--column');
      const column =
        columnIdx >= 0 ? (sub[columnIdx + 1] as import('@anvio/core').KanbanColumn) : undefined;
      const tasks = await kanban.listTasks(undefined, column);
      if (tasks.length === 0) {
        console.log('No kanban tasks. Create one: anvio kanban create --title "My Task"');
        return;
      }
      for (const task of tasks) {
        const assignees = task.spec.assignees.map((a) => a.id).join(', ') || '-';
        console.log(
          `  ${task.metadata.id} [${task.spec.column}] ${task.spec.title} — ${assignees}`,
        );
      }
      break;
    }
    case 'create': {
      const titleIdx = sub.indexOf('--title');
      const title = titleIdx >= 0 ? sub[titleIdx + 1] : undefined;
      if (!title) {
        console.error('Usage: anvio kanban create --title <title> [--lane coding]');
        process.exit(1);
      }
      const laneIdx = sub.indexOf('--lane');
      const lane = laneIdx >= 0 ? sub[laneIdx + 1] : undefined;
      const task = await kanban.createTask({ title, lane });
      if (sub.includes('--auto-assign')) {
        await kanban.autoAssign(task.metadata.id);
      }
      console.log(`Created task: ${task.metadata.id}`);
      break;
    }
    case 'move': {
      const taskId = sub[1];
      const columnIdx = sub.indexOf('--column');
      const column =
        columnIdx >= 0 ? (sub[columnIdx + 1] as import('@anvio/core').KanbanColumn) : undefined;
      if (!taskId || !column) {
        console.error(
          'Usage: anvio kanban move <taskId> --column <backlog|todo|doing|review|done>',
        );
        process.exit(1);
      }
      const task = await kanban.moveTask(taskId, column);
      console.log(`Moved ${task.metadata.id} → ${task.spec.column}`);
      break;
    }
    case 'assign': {
      const taskId = sub[1];
      const agentIdx = sub.indexOf('--agent');
      const agentId = agentIdx >= 0 ? sub[agentIdx + 1] : undefined;
      if (!taskId || !agentId) {
        console.error('Usage: anvio kanban assign <taskId> --agent <agentId>');
        process.exit(1);
      }
      const task = await kanban.assignAgent(taskId, agentId);
      console.log(`Assigned ${agentId} to ${task.metadata.id}`);
      break;
    }
    default:
      console.error('Usage: anvio kanban list|create|move|assign');
      process.exit(1);
  }
}

export async function cmdBatch(sub: string[]) {
  const action = sub[0] ?? 'run';
  const wsPath = resolveWorkspacePath();
  const storage = new FilesystemStorageProvider(wsPath);
  const platform = await getPlatform();
  const batch = createBatchEngine({
    storage,
    workspaceRoot: wsPath,
    blueprintRunner: {
      run: (blueprint, inputs, options) =>
        platform.blueprintExecutor.run(blueprint, inputs, options),
    },
  });

  switch (action) {
    case 'run': {
      const blueprint = sub[1];
      const inputIdx = sub.indexOf('--input');
      const inputPath = inputIdx >= 0 ? sub[inputIdx + 1] : undefined;
      const concurrencyIdx = sub.indexOf('--concurrency');
      const concurrency = concurrencyIdx >= 0 ? Number(sub[concurrencyIdx + 1]) : 3;
      const dryRun = sub.includes('--dry-run');
      if (!blueprint) {
        console.error(
          'Usage: anvio batch run <blueprint> [--input file.txt] [--concurrency N] [--dry-run]',
        );
        process.exit(1);
      }
      const result = await batch.run(
        {
          name: `Batch ${blueprint}`,
          blueprint,
          input: inputPath
            ? { type: 'file', path: inputPath, items: [], itemTemplate: { repository: '{{line}}' } }
            : { type: 'inline', items: [{ userId: 'local-user' }] },
          concurrency,
          retry: {
            maxAttempts: 3,
            backoff: 'exponential',
            delayMs: 1000,
            retryOn: ['timeout', 'rate_limit'],
          },
          dryRun,
        },
        undefined,
        { dryRun },
      );
      console.log(
        JSON.stringify(
          { jobId: result.jobId, status: result.status, progress: result.progress },
          null,
          2,
        ),
      );
      break;
    }
    case 'status': {
      const jobId = sub[1];
      if (!jobId) {
        console.error('Usage: anvio batch status <jobId>');
        process.exit(1);
      }
      const status = await batch.getStatus(jobId);
      const progress = await batch.getProgress(jobId);
      console.log(JSON.stringify({ status, progress }, null, 2));
      break;
    }
    case 'resume': {
      const jobId = sub[1];
      const retryFailed = sub.includes('--retry-failed');
      if (!jobId) {
        console.error('Usage: anvio batch resume <jobId> [--retry-failed]');
        process.exit(1);
      }
      const result = await batch.resume(jobId, retryFailed);
      console.log(
        JSON.stringify(
          { jobId: result.jobId, status: result.status, progress: result.progress },
          null,
          2,
        ),
      );
      break;
    }
    case 'cancel': {
      const jobId = sub[1];
      if (!jobId) {
        console.error('Usage: anvio batch cancel <jobId>');
        process.exit(1);
      }
      await batch.cancel(jobId);
      console.log(`Batch cancelled: ${jobId}`);
      break;
    }
    default:
      console.error('Usage: anvio batch run|status|resume|cancel');
      process.exit(1);
  }
}

export async function cmdWorkflow(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const registry = createWorkflowRegistry(wsPath, findRepoRoot(wsPath));
  const executor = new DagExecutor({ registry });

  switch (action) {
    case 'list': {
      const items = await registry.listAll();
      if (items.length === 0) {
        console.log('No workflows found in workspace/workflows/.');
        return;
      }
      for (const item of items) {
        const wf = await registry.load(item.slug);
        console.log(`  ${item.slug} [${item.source}] — ${wf.spec.description}`);
      }
      break;
    }
    case 'validate': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio workflow validate <file.yaml>');
        process.exit(1);
      }
      const wf = await registry.validateFile(path.resolve(file));
      console.log(`Valid: ${wf.metadata.slug} (${wf.spec.nodes.length} nodes)`);
      break;
    }
    case 'run': {
      const slug = sub[1];
      const dryRun = sub.includes('--dry-run');
      if (!slug) {
        console.error('Usage: anvio workflow run <slug> [--dry-run] [key=value ...]');
        process.exit(1);
      }
      const inputs: Record<string, unknown> = {};
      for (const arg of sub.slice(2)) {
        if (arg.startsWith('--')) continue;
        const [k, v] = arg.split('=');
        if (k && v) inputs[k] = v;
      }
      const result = await executor.run(slug, inputs, { dryRun });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio workflow list|validate|run');
      process.exit(1);
  }
}
