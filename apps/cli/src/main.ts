#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { EventSubjects } from '@anvio/events';
import { CliChannel } from '@anvio/channels';
import type { StoredSession } from '@anvio/core';
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
    case 'run':
      await cmdRun(args.slice(1));
      break;
    case 'sessions':
      await cmdSessions(args.slice(1));
      break;
    case 'status':
      await cmdStatus(args.slice(1));
      break;
    case 'logs':
      await cmdLogs(args.slice(1));
      break;
    case 'approve':
      await cmdApprove(args.slice(1));
      break;
    case 'stop':
      await cmdStop(args.slice(1));
      break;
    case 'inbox':
      await cmdInbox(args.slice(1));
      break;
    case 'help':
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`Anvio — Local-First AI Agent Operating System

Usage:
  anvio init [path]              Initialize a new workspace
  anvio agents list              List available agents
  anvio chat [--agent NAME]      Interactive chat
  anvio run <agent> [message]    Run agent task (--detach for background)
  anvio sessions [list]          List agent sessions
  anvio status [sessionId]       Show session or platform status
  anvio logs <sessionId>         Show session message log
  anvio approve <session> <id>   Approve pending tool request
  anvio stop <sessionId>         Stop running agent session
  anvio inbox <sessionId> <msg>  Inject instruction into running agent

Environment:
  ANTHROPIC_API_KEY              Model provider API key
  ANVIO_WORKSPACE                Workspace path (default: ./workspace)

Priority: CLI > API > Web UI — entire platform usable without Web UI`);
}

async function cmdInit(targetPath?: string) {
  const root = path.resolve(targetPath ?? './workspace');
  await Workspace.init(root);
  console.log(`Workspace initialized at ${root}`);
  console.log('Edit agents/, personas/, skills/ — then run: anvio run architect');
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

async function getPlatform() {
  const wsPath = resolveWorkspacePath();
  return createPlatform({ workspacePath: wsPath });
}

async function cmdRun(sub: string[]) {
  const detach = sub.includes('--detach');
  const filtered = sub.filter((a) => a !== '--detach');
  const agentName = filtered[0];
  const message = filtered.slice(1).join(' ').trim() || 'Start task.';

  if (!agentName) {
    console.error('Usage: anvio run <agent> [message] [--detach]');
    process.exit(1);
  }

  const platform = await getPlatform();
  const { workspace, runtime, auth, eventBus, channelHub } = platform;
  const agent = await loadAgent(workspace, agentName);
  const ctx = auth.getDefaultContext();

  const cliChannel = channelHub.getAdapter('cli') as CliChannel | undefined;
  cliChannel?.setSink({
    onChunk: (_id, delta) => process.stdout.write(delta),
    onProgress: (_id, phase, emoji) => process.stdout.write(`${emoji} ${phase}\n`),
  });

  const stored = await workspace.sessions.create({
    userId: ctx.userId,
    agentName,
    channel: 'cli',
    messages: [],
    status: 'idle',
    detached: detach,
  });

  const session = storedSessionToRuntime(stored);
  console.log(`\n🚀 Running ${agentName} (session: ${stored.id})${detach ? ' [detached]' : ''}\n`);

  if (detach) {
    await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
      sessionId: stored.id,
      userId: ctx.userId,
      agentId: agentName,
      content: message,
      channel: 'cli',
      detached: true,
    });
    console.log('Task queued. Use `anvio status` or `anvio logs` to monitor.');
    return;
  }

  let full = '';
  for await (const chunk of runtime.stream(session, agent, { content: message })) {
    if (chunk.type === 'progress') {
      process.stdout.write(`🔄 ${chunk.phase}\n`);
    }
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
          { role: 'user', content: message },
          { role: 'assistant', content: full },
        ],
        status: 'completed',
      });
    }
  }
}

async function cmdSessions(sub: string[]) {
  const platform = await getPlatform();
  const { workspace, auth } = platform;
  const ctx = auth.getDefaultContext();
  const sessions = await workspace.sessions.list(ctx.userId);

  if (sub[0] === 'list' || sub.length === 0) {
    if (sessions.length === 0) {
      console.log('No sessions.');
      return;
    }
    printSessionTable(sessions);
  }
}

function printSessionTable(sessions: StoredSession[]) {
  console.log('ID                                   Agent        Channel    Status');
  console.log('─'.repeat(72));
  for (const s of sessions) {
    console.log(
      `${s.id}  ${s.agentName.padEnd(12)} ${s.channel.padEnd(10)} ${s.status}${s.detached ? ' (detached)' : ''}`,
    );
  }
}

async function cmdStatus(sub: string[]) {
  const platform = await getPlatform();
  const { workspace } = platform;
  const sessionId = sub[0];

  if (!sessionId) {
    const active = await workspace.sessions.listActive();
    console.log(`Active sessions: ${active.length}`);
    if (active.length > 0) printSessionTable(active);
    return;
  }

  const session = await workspace.sessions.get(sessionId);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }
  console.log(JSON.stringify(session, null, 2));
}

async function cmdLogs(sub: string[]) {
  const sessionId = sub[0];
  if (!sessionId) {
    console.error('Usage: anvio logs <sessionId>');
    process.exit(1);
  }
  const platform = await getPlatform();
  const session = await platform.workspace.sessions.get(sessionId);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }
  for (const msg of session.messages) {
    console.log(`[${msg.role}] ${msg.content}\n`);
  }
}

async function cmdApprove(sub: string[]) {
  const reject = sub.includes('--reject');
  const filtered = sub.filter((a) => a !== '--reject');
  const [sessionId, requestId] = filtered;

  if (!sessionId || !requestId) {
    console.error('Usage: anvio approve <sessionId> <requestId> [--reject]');
    process.exit(1);
  }

  const platform = await getPlatform();
  await platform.eventBus.publish(EventSubjects.APPROVAL_DECIDED, 'anvio.approval.decided', {
    sessionId,
    requestId,
    approved: !reject,
  });
  console.log(reject ? 'Rejected.' : 'Approved.');
}

async function cmdStop(sub: string[]) {
  const sessionId = sub[0];
  if (!sessionId) {
    console.error('Usage: anvio stop <sessionId>');
    process.exit(1);
  }
  const platform = await getPlatform();
  await platform.eventBus.publish(
    EventSubjects.AGENT_RUN_STOP_REQUESTED,
    'anvio.agent.run.stop',
    { sessionId, reason: 'User requested stop' },
  );
  console.log(`Stop requested for ${sessionId}`);
}

async function cmdInbox(sub: string[]) {
  const sessionId = sub[0];
  const content = sub.slice(1).join(' ').trim();
  if (!sessionId || !content) {
    console.error('Usage: anvio inbox <sessionId> <instruction>');
    process.exit(1);
  }

  const platform = await getPlatform();
  const type = content.toLowerCase() === 'stop' ? 'stop' : 'instruction';
  const msg = await platform.inbox.inject({ sessionId, type, content });
  await platform.eventBus.publish(EventSubjects.AGENT_INBOX_INJECTED, 'anvio.agent.inbox.injected', {
    sessionId,
    messageId: msg.id,
    type,
    content,
  });
  console.log(`Inbox message injected (${type})`);
}

async function cmdChat(sub: string[]) {
  const agentFlag = sub.indexOf('--agent');
  const agentName = agentFlag >= 0 ? sub[agentFlag + 1] : undefined;

  const platform = await getPlatform();
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
