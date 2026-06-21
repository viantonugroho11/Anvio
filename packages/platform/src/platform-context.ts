import type { DefaultAgentRuntime } from '@anvio/agents';
import type { AuthProvider, AgentInbox, ChannelHubPort, ModelProvider } from '@anvio/core';
import type { AutomationEngine } from '@anvio/automation';
import type { BlueprintExecutor } from '@anvio/blueprints';
import type { HookEngine } from '@anvio/hooks';
import type { HarnessGateway } from '@anvio/harness';
import type { McpFirstCallGate } from '@anvio/integrations';
import type { LearningEngine } from '@anvio/learning';
import type { ModelProviderRegistry } from '@anvio/models';
import type { ToolGateway } from '@anvio/tools';
import type { WhatsAppChannel } from '@anvio/channels';
import type { EventBusLike } from '@anvio/events';
import type { Workspace } from '@anvio/workspace';

export interface PlatformContext {
  workspace: Workspace;
  auth: AuthProvider;
  runtime: DefaultAgentRuntime;
  eventBus: EventBusLike;
  modelProvider: ModelProvider;
  modelProviders: ModelProviderRegistry;
  channelHub: ChannelHubPort;
  inbox: AgentInbox;
  whatsapp?: WhatsAppChannel;
  blueprintExecutor: BlueprintExecutor;
  automationEngine: AutomationEngine;
  hookEngine: HookEngine;
  harness: HarnessGateway;
  learningEngine: LearningEngine;
  toolGateway: ToolGateway;
  mcpFirstCallGate: McpFirstCallGate;
}
