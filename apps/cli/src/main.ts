#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { createPlatform, loadAgent, storedSessionToRuntime } from '@anvio/platform';
import { Workspace } from '@anvio/workspace';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

async function main() {
  switch (command) {
    case 'init':
      await cmdInit(args[1]);
      break;
    case 'agents':
      await cmdAgents(args.slice(1));
      break;
    case 'chat':
      await cmdChat(args.slice(1));
      break;
    case 'help':
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`Anvio — Local-First AI Agent Operating System

Usage:
  anvio init [path]           Initialize a new workspace
  anvio agents list           List available agents
  anvio chat [--agent NAME]   Start interactive chat (no login required)

Environment:
  ANTHROPIC_API_KEY           Model provider API key (optional — mock mode without)
  ANVIO_WORKSPACE             Workspace path (default: ./workspace)

Priority: CLI > API > Web UI
Default: filesystem storage, no authentication`);
}

async function cmdInit(targetPath?: string) {
  const root = path.resolve(targetPath ?? './workspace');
  await Workspace.init(root);
  console.log(`Workspace initialized at ${root}`);
  console.log('Edit agents/, personas/, skills/ — then run: anvio chat');
}

async function cmdAgents(sub: string[]) {
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  if (sub[0] === 'list' || sub.length === 0) {
    const agents = await workspace.loader.listAgents();
    if (agents.length === 0) {
      console.log('No agents found. Add YAML files to workspace/agents/');
      return;
    }
    console.log('Agents:');
    for (const name of agents) {
      const agent = await workspace.loader.loadAgent(name);
      console.log(`  ${name} — ${agent.spec.description}`);
    }
  }
}

async function cmdChat(sub: string[]) {
  const agentFlag = sub.indexOf('--agent');
  const agentName =
    agentFlag >= 0 ? sub[agentFlag + 1] : undefined;

  const wsPath = resolveWorkspacePath();
  const platform = await createPlatform({ workspacePath: wsPath });
  const { workspace, runtime, auth } = platform;

  const name = agentName ?? workspace.config.spec.defaultAgent ?? 'architect';
  const agent = await loadAgent(workspace, name);
  const ctx = auth.getDefaultContext();

  const stored = await workspace.sessions.create({
    userId: ctx.userId,
    agentName: name,
    channel: 'cli',
    messages: [],
    status: 'idle',
  });

  const session = storedSessionToRuntime(stored);
  console.log(`\nAnvio Chat — agent: ${name} (session: ${stored.id})`);
  console.log('Type your message. Ctrl+C to exit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('You: ', async (input) => {
      const content = input.trim();
      if (!content) {
        prompt();
        return;
      }

      process.stdout.write('Assistant: ');
      let full = '';

      for await (const chunk of runtime.stream(session, agent, { content })) {
        if (chunk.type === 'chunk' && chunk.delta) {
          process.stdout.write(chunk.delta);
          full += chunk.delta;
        }
        if (chunk.type === 'error') {
          console.error(`\nError: ${chunk.error}`);
        }
        if (chunk.type === 'done') {
          console.log('\n');
          await workspace.sessions.update(stored.id, {
            messages: [
              ...stored.messages,
              { role: 'user', content },
              { role: 'assistant', content: full },
            ],
          });
          stored.messages.push(
            { role: 'user', content },
            { role: 'assistant', content: full },
          );
        }
      }
      prompt();
    });
  };

  prompt();
}

function resolveWorkspacePath(): string {
  if (process.env.ANVIO_WORKSPACE) return process.env.ANVIO_WORKSPACE;
  return path.resolve(process.cwd(), 'workspace');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
