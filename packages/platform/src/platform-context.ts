import type { AgentRuntime } from '@anvio/core';
import type { RuntimeFactory } from '@anvio/runtimes';
import type { CredentialPoolManager } from '@anvio/core';
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
  runtime: AgentRuntime;
  runtimeFactory: RuntimeFactory;
  eventBus: EventBusLike;
  modelProvider: ModelProvider;
  modelProviders: ModelProviderRegistry;
  /**
   * Present only when ANVIO_CREDENTIALS_PASSPHRASE is set. Absent means the
   * feature is off — never that credentials are stored under a weaker key.
   */
  credentialPools?: CredentialPoolManager;
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
