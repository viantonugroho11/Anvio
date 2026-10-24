#!/usr/bin/env node
import { installProcessErrorGuards } from '@anvio/platform';
import { cmdGateway, cmdMcp, cmdTrash, cmdWorkspace } from './commands/gateway.js';
import { cmdConnect, cmdHarness, cmdSetupToken, cmdSoul } from './commands/identity.js';
import {
  cmdAutomation,
  cmdBatch,
  cmdBlueprint,
  cmdCron,
  cmdGoal,
  cmdHooks,
  cmdKanban,
  cmdPlanner,
  cmdWorkflow,
} from './commands/planning.js';
import {
  cmdAcp,
  cmdChannels,
  cmdCredentials,
  cmdExecution,
  cmdRouting,
  cmdRuntime,
  cmdUsage,
  cmdWorktree,
} from './commands/runtime.js';
import {
  cmdAgents,
  cmdApprove,
  cmdChat,
  cmdInbox,
  cmdInit,
  cmdLogs,
  cmdRun,
  cmdSessions,
  cmdStatus,
  cmdStop,
} from './commands/sessions.js';
import { cmdKb, cmdLearning, cmdSkill, cmdTools, cmdVoice } from './commands/skills.js';

const args = process.argv.slice(2);

const command = args[0] ?? 'help';

async function main() {
  installProcessErrorGuards('cli');
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
    case 'session':
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
    case 'worktree':
      await cmdWorktree(args.slice(1));
      break;
    case 'channels':
      await cmdChannels(args.slice(1));
      break;
    case 'harness':
      await cmdHarness(args.slice(1));
      break;
    case 'connect':
      await cmdConnect(args.slice(1));
      break;
    case 'setup-token':
      await cmdSetupToken(args.slice(1));
      break;
    case 'soul':
      await cmdSoul(args.slice(1));
      break;
    case 'goal':
      await cmdGoal(args.slice(1));
      break;
    case 'blueprint':
      await cmdBlueprint(args.slice(1));
      break;
    case 'automation':
      await cmdAutomation(args.slice(1));
      break;
    case 'cron':
      await cmdCron(args.slice(1));
      break;
    case 'hooks':
      await cmdHooks(args.slice(1));
      break;
    case 'kanban':
      await cmdKanban(args.slice(1));
      break;
    case 'batch':
      await cmdBatch(args.slice(1));
      break;
    case 'runtime':
      await cmdRuntime(args.slice(1));
      break;
    case 'execution':
    case 'exec':
      await cmdExecution(args.slice(1));
      break;
    case 'acp':
      await cmdAcp(args.slice(1));
      break;
    case 'credentials':
      await cmdCredentials(args.slice(1));
      break;
    case 'routing':
      await cmdRouting(args.slice(1));
      break;
    case 'usage':
      await cmdUsage(args.slice(1));
      break;
    case 'planner':
      await cmdPlanner(args.slice(1));
      break;
    case 'skill':
    case 'skills':
      await cmdSkill(args.slice(1));
      break;
    case 'mcp':
      await cmdMcp(args.slice(1));
      break;
    case 'tools':
      await cmdTools(args.slice(1));
      break;
    case 'kb':
      await cmdKb(args.slice(1));
      break;
    case 'learning':
      await cmdLearning(args.slice(1));
      break;
    case 'workflow':
      await cmdWorkflow(args.slice(1));
      break;
    case 'voice':
      await cmdVoice(args.slice(1));
      break;
    case 'gateway':
      await cmdGateway(args.slice(1));
      break;
    case 'workspace':
      await cmdWorkspace(args.slice(1));
      break;
    case 'trash':
      await cmdTrash(args.slice(1));
      break;
    case 'help':
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`Anvio — Local-First AI Agent Operating System

Core
  anvio init [path]                    Initialize workspace scaffold
  anvio agents list                    List configured agents
  anvio chat [--agent NAME]            Interactive chat session
  anvio run <agent> [message]          Run task (--detach for background)
  anvio sessions list                  List agent sessions
  anvio session 1on1 [--agent NAME]    Dedicated 1-on-1 CLI session
  anvio session export <id> [--md]     Export session trajectory (P14 research)
  anvio status [sessionId]             Platform or session status
  anvio logs <sessionId>               Session message log
  anvio approve <session> <id>         Approve pending tool request
  anvio stop <sessionId>               Stop running session
  anvio inbox <sessionId> <msg>        Inject instruction into running agent
  anvio worktree list|create|remove    Git worktree isolation
  anvio channels status [--json]       Channel adapter health check
  anvio harness status|simulate        Channel harness (Phase G)
  anvio harness simulate --scenario <file...>  End-to-end scenario run (ADR 0033)
  anvio connect list|put|revoke|login-host|login  Contextual connections broker
  anvio setup-token --claude|--cursor|--codex|--antigravity|--nous  Official runtime OAuth login

Advanced Agent OS — Identity & Goals
  anvio soul list|show|create          Persistent agent souls
  anvio soul import|validate-policy    SOUL.md policy gate
  anvio goal list|create|progress      Goal tracking
  anvio goal complete|pause|resume     Goal lifecycle

Automation & Workflows
  anvio blueprint catalog|run          Workflow blueprint catalog
  anvio automation list|run|enable     Event and scheduled automations
  anvio planner phases|run <task>      PLAN → EXECUTE → REVIEW orchestration
  anvio cron list|next-runs            Cron schedule utilities
  anvio hooks test <event>             Test event hook handlers
  anvio batch run|status|resume        Parallel batch jobs

Coordination
  anvio kanban list|create|move        Kanban board tasks

Execution & Providers
  anvio runtime list|test              Runtime providers (local, ssh, cursor, …)
  anvio exec run|audit                 Sandboxed code execution
  anvio acp serve|status               ACP editor integration server
  anvio credentials list|add|test      Encrypted credential pools
  anvio routing show|providers|catalog|test  Provider routing and fallback
  anvio usage stats [--json] [--last 24h] Token usage from audit ledger
  anvio skill catalog|install|import|validate|upgrade|test  Skills catalog management & testing
  anvio mcp list|test|health|preset    MCP integration servers
  anvio tools list|test                Built-in tool gateway (Phase H)
  anvio kb list|ingest|sync|import-manifest   Knowledge base pipeline
  anvio learning drafts|promote|summarize-sessions|consolidate
  anvio workflow list|validate|run     Standalone DAG workflow engine (Phase I)
  anvio voice transcribe|stream-transcribe|realtime-transcribe|speak
  anvio gateway start|stop|status         Unified Hermes-style gateway daemon
  anvio workspace validate             Validate workspace structure
  anvio trash list|rm|restore|prune    Workspace soft-delete + restore (ADR-0025)

Environment
  ANVIO_CONNECTION_ENCRYPTION_KEY      Encrypt contextual connection payloads
  ANTHROPIC_API_KEY                    Anthropic (Claude)
  OPENAI_API_KEY                       OpenAI (GPT)
  GEMINI_API_KEY / GOOGLE_API_KEY      Google Gemini
  OPENROUTER_API_KEY                   OpenRouter (100+ models)
  DEEPSEEK_API_KEY                     DeepSeek (deepseek-chat, deepseek-reasoner)
  GROQ_API_KEY / MISTRAL_API_KEY       Groq, Mistral
  TOGETHER_API_KEY / XAI_API_KEY        Together, xAI Grok
  FIREWORKS_API_KEY / MOONSHOT_API_KEY  Fireworks, Moonshot/Kimi
  CEREBRAS_API_KEY / SAMBANOVA_API_KEY  Cerebras, SambaNova
  PERPLEXITY_API_KEY / COHERE_API_KEY   Perplexity, Cohere
  HF_TOKEN                             Hugging Face Inference
  OLLAMA_BASE_URL / OLLAMA_ENABLED     Local Ollama models
  ANVIO_CREDENTIALS_PASSPHRASE         Credential pool encryption passphrase
  TELEGRAM_BOT_TOKEN / DISCORD_BOT_TOKEN / SLACK_BOT_TOKEN / SLACK_APP_TOKEN
  WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_VERIFY_TOKEN
  GITHUB_TOKEN                         MCP GitHub server (when enabled)

Docs: docs/24-advanced-agent-os-overview.md
Priority: CLI > API > Web UI`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
