# Graph Report - packages  (2026-08-13)

## Corpus Check
- 413 files · ~107,670 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4021 nodes · 6577 edges · 239 communities (181 shown, 58 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237

## God Nodes (most connected - your core abstractions)
1. `runBuiltinTool()` - 77 edges
2. `buffer` - 37 edges
3. `HarnessGateway` - 26 edges
4. `WebhookChannelAdapter` - 22 edges
5. `FilesystemMemoryProvider` - 21 edges
6. `ChannelType` - 20 edges
7. `DiscordChannel` - 19 edges
8. `ChatMessage` - 19 edges
9. `createPlatform()` - 19 edges
10. `BaseChannelAdapter` - 18 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `parseAgentDefinition()`  [INFERRED]
  db/src/seed.ts → core/src/schemas/agent.schema.ts
- `main()` --indirect_call--> `parsePersonaDefinition()`  [INFERRED]
  db/src/seed.ts → core/src/schemas/persona.schema.ts
- `readJson()` --references--> `buffer`  [EXTRACTED]
  acp/src/acp-server.ts → integrations/scripts/mock-mcp-server.mjs
- `base64url()` --references--> `buffer`  [EXTRACTED]
  channels/src/google-chat-auth.ts → integrations/scripts/mock-mcp-server.mjs
- `readResponse()` --references--> `buffer`  [EXTRACTED]
  channels/src/imap-client.ts → integrations/scripts/mock-mcp-server.mjs

## Import Cycles
- 2-file cycle: `platform/src/index.ts -> platform/src/unified-gateway.ts -> platform/src/index.ts`

## Communities (239 total, 58 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (39): WebChatChannel, WebChatClient, finalizeAgentRun(), publishAgentRunCompleted(), findRepoRoot(), findWorkspacePath(), handleGatewayHttp(), json() (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (26): ModelProvider, SoulStore, hashSoulSource(), readCachedPolicy(), writeCachedPolicy(), bulletValues(), fieldValue(), loadSoulPolicy() (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (34): createEvent(), deserializeEvent(), serializeEvent(), EventBus, EventBusOptions, EventHandler, createEventBus(), LocalEventBus (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (29): DelegationEventPublisher, DelegationProgressSnapshot, DelegationProgressTracker, approvalSummaryFromResult(), executeNativeToolCalls(), createOrchestrationPlan(), sleep(), SupervisorOrchestrator (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (21): EmailChannelOptions, FeishuChannel, FeishuChannelOptions, FetchRetryOptions, fetchWithRetry(), sleep(), base64url(), getGoogleChatAccessToken() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (20): createWorktreeManager(), exec, GitWorktreeManager, GitWorktreeManagerOptions, createSessionStore(), defaultAnvioYaml(), defaultHarnessProfilesYaml(), defaultHarnessYaml() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (19): CreateGoalInput, GoalEngine, GoalStore, UpdateGoalProgressInput, goalAssigneeSchema, GoalDefinition, goalDefinitionSchema, goalIndexSchema (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (8): LocalAgentInbox, FilesystemAgentInbox, ConfigLoader, StorageObject, StorageProvider, PersonaService, readTokenUsageAudit(), appendJsonl()

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (40): bcryptjs, dependencies, @anvio/core, bcryptjs, drizzle-orm, postgres, uuid, yaml (+32 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (31): SessionSearchFn, browserAction(), BrowserActionInput, tryLoadPlaywright(), BuiltinToolContext, memoryRecall(), MemoryRecallFn, httpRequest() (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (38): dependencies, @anvio/core, @anvio/events, @anvio/memory, @anvio/models, @anvio/personas, @anvio/skills, @anvio/souls (+30 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (23): CreateKanbanTaskInput, KanbanEngine, KanbanStore, AgentWorkStatus, agentWorkStatusSchema, AssigneeState, assigneeStateSchema, assigneeTypeSchema (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (28): AntigravitySetupTokenOptions, isAuthSuccess(), runAntigravitySetupToken(), CodexSetupTokenOptions, defaultCodexAuthPath(), parseCodexConnectionPayload(), runCodexSetupToken(), CursorSetupTokenOptions (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (27): AgentResult, AgentRuntime, AgentRuntimeContext, AgentStreamEvent, ApprovalDecision, ApprovalRequest, Session, SessionState (+19 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (21): MemoryContext, MemoryEntry, MemoryEntryType, MemoryStore, SearchOptions, SemanticMemoryPort, MemoryProviderHealth, ChatRequest (+13 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (34): dependencies, @opentelemetry/api, @opentelemetry/auto-instrumentations-node, @opentelemetry/exporter-trace-otlp-http, @opentelemetry/resources, @opentelemetry/sdk-node, @opentelemetry/semantic-conventions, pino (+26 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (32): clarifyTool(), sessionSearchTool(), TodoItem, todoStore, todoTool(), atroposDirectCall(), computerUse(), discordAdmin() (+24 more)

### Community 17 - "Community 17"
Cohesion: 0.10
Nodes (14): BaseChannelAdapter, ChannelSessionBridge, ChannelSessionBridgeDefaults, MattermostChannelOptions, MattermostPost, MattermostWebSocketEvent, parseChatTarget(), sleep() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (26): AgentMdFrontmatter, parseAgentMd(), ParsedMarkdownDocument, parseFrontmatter(), parsePersonaMd(), PersonaMdFrontmatter, parseSkillMd(), SkillMdFrontmatter (+18 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (33): dependencies, @anvio/core, @anvio/storage, better-sqlite3, uuid, yaml, devDependencies, @types/better-sqlite3 (+25 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (12): BlueprintExecutionDeps, BlueprintExecutor, BlueprintRunOptions, BlueprintRunResult, BlueprintStepResult, callTool(), BlueprintCatalogRegistry, CatalogPaths (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (31): @anvio/db, playwright, dependencies, @anvio/core, @anvio/db, @anvio/voice, yaml, devDependencies (+23 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (20): BatchEngine, BatchRunOptions, BatchRunResult, BlueprintRunner, batchInputSchema, BatchItemRecord, batchItemRecordSchema, BatchItemStatus (+12 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (30): Browser, browserBack(), browserCdp(), browserClick(), browserConsole(), browserDialog(), browserGetImages(), browserNavigate() (+22 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (30): @anthropic-ai/sdk, dependencies, @anthropic-ai/sdk, @anvio/core, @anvio/observability, @anvio/storage, yaml, devDependencies (+22 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (30): dependencies, @anvio/blueprints, @anvio/core, @anvio/events, @anvio/storage, yaml, devDependencies, typescript (+22 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (22): parseSkillDefinition(), createDb(), Database, Agent, agents, agentSkills, memoryEntries, Persona (+14 more)

### Community 27 - "Community 27"
Cohesion: 0.09
Nodes (11): ChannelHubBundle, ChannelHub, createChannelHub(), CreateChannelHubOptions, createInboundHandler(), mergeVoiceOptions(), registerAdapter(), resolveVoicePipeline() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (20): EmailChannel, awaitTaggedResponse(), dispatchNewMessages(), extractFetchBody(), hasIdleCapability(), idleWatchInbox(), imapCommand(), ImapIdleOptions (+12 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (9): assertWipLimit(), ensureDefaultBoard(), createKanbanEngine(), KanbanEngineDeps, KanbanEngineImpl, AgentCapability, defaultAgentCapabilities(), defaultWorkerLanes() (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (29): dependencies, @anvio/core, @anvio/storage, devDependencies, @types/better-sqlite3, typescript, vitest, exports (+21 more)

### Community 31 - "Community 31"
Cohesion: 0.14
Nodes (16): RuntimeFactory, AGENT_RUNTIME_PROVIDER_IDS, AgentRuntimeProviderId, buildAgentRuntimeChain(), dedupeRuntimeChain(), firstConfiguredRuntimeId(), isRuntimeFailoverRetryable(), isRuntimeFailoverRetryableMessage() (+8 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (28): dependencies, @anvio/core, @anvio/events, @anvio/voice, uuid, devDependencies, typescript, vitest (+20 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (28): dependencies, @anvio/core, nats, uuid, devDependencies, @types/uuid, typescript, vitest (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.07
Nodes (28): dependencies, @anvio/core, @anvio/events, @anvio/storage, yaml, devDependencies, typescript, vitest (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (7): IngestResult, KnowledgeIngestEngine, KnowledgeBaseStore, WorkspaceManifest, WorkspaceManifestImporter, WorkspaceManifestImportResult, workspaceManifestSchema

### Community 36 - "Community 36"
Cohesion: 0.15
Nodes (25): appendFile(), editFile(), executeCodeWithExecutor(), fileDelete(), fileRead(), fileWrite(), listDir(), pathExists() (+17 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (26): acpConfigSchema, AuthConfig, authConfigSchema, channelProviderSchema, channelsConfigSchema, credentialsConfigSchema, emailChannelSchema, eventsConfigSchema (+18 more)

### Community 38 - "Community 38"
Cohesion: 0.07
Nodes (27): dependencies, @anvio/core, @anvio/storage, yaml, devDependencies, @anvio/workspace, typescript, vitest (+19 more)

### Community 39 - "Community 39"
Cohesion: 0.13
Nodes (16): imageGenerate(), textToSpeech(), searchFiles(), CodePipelineStep, globFiles(), globToRegExp(), grepSearch(), walkFiles() (+8 more)

### Community 40 - "Community 40"
Cohesion: 0.08
Nodes (26): dependencies, @anvio/core, @anvio/storage, yaml, devDependencies, typescript, vitest, exports (+18 more)

### Community 41 - "Community 41"
Cohesion: 0.11
Nodes (10): ChannelAdapter, ChannelHubPort, InboundMessage, InboundMessageHandler, OutboundMessage, InboundEnvelope, AgentNotification, ApprovalRequestMessage (+2 more)

### Community 42 - "Community 42"
Cohesion: 0.08
Nodes (13): AcquiredCredential, CredentialPoolManager, CredentialStore, CredentialEntry, credentialEntrySchema, CredentialPool, credentialPoolSchema, credentialPoolsIndexSchema (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.08
Nodes (26): dependencies, @anvio/core, @anvio/storage, yaml, devDependencies, typescript, vitest, exports (+18 more)

### Community 44 - "Community 44"
Cohesion: 0.08
Nodes (26): dependencies, @anvio/core, @anvio/events, yaml, devDependencies, typescript, vitest, exports (+18 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (7): DockerRuntimeOptions, DockerRuntimeProvider, LocalRuntimeProvider, createRuntimeFactory(), RuntimeFactoryDeps, SshRuntimeOptions, SshRuntimeProvider

### Community 46 - "Community 46"
Cohesion: 0.17
Nodes (18): buildTrace(), evaluateCondition(), executeSkill(), runStep(), SkillExecuteInput, SkillExecuteResult, SkillStepError, SkillStepResult (+10 more)

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (26): dependencies, @anvio/core, @anvio/storage, yaml, devDependencies, typescript, vitest, exports (+18 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (25): @anthropic-ai/claude-agent-sdk, dependencies, @anthropic-ai/claude-agent-sdk, @anvio/core, @anvio/harness, devDependencies, typescript, vitest (+17 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (25): dependencies, @anvio/core, jsonwebtoken, devDependencies, @types/jsonwebtoken, typescript, vitest, exports (+17 more)

### Community 50 - "Community 50"
Cohesion: 0.17
Nodes (11): BatchEngineDeps, BatchEngineImpl, createBatchEngine(), sleep(), computeProgress(), backoffDelay(), buildItemsFromLines(), isRetryableError() (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.14
Nodes (9): DiscordChannel, DiscordChannelOptions, DiscordGatewayPayload, DiscordInteraction, DiscordMessage, guessAudioMime(), isAudioAttachment(), splitMessage() (+1 more)

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (25): dependencies, @anvio/core, @anvio/storage, yaml, devDependencies, typescript, vitest, exports (+17 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (25): dependencies, @anvio/core, @anvio/soul-gate, yaml, devDependencies, typescript, vitest, exports (+17 more)

### Community 54 - "Community 54"
Cohesion: 0.17
Nodes (17): loadHarnessConfig(), loadHarnessProfiles(), resolveChannelProfile(), LoginHostOptions, LoginHostSession, startLoginHost(), EngagementState, evaluateEngagement() (+9 more)

### Community 55 - "Community 55"
Cohesion: 0.08
Nodes (25): dependencies, @anvio/core, yaml, zod, devDependencies, typescript, vitest, exports (+17 more)

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (12): bigUsage, stubStorage, createModelRouter(), ModelRouterDeps, RoutedChatRequest, RoutedChatResponse, SpendBudgetLedger, ClassificationInput (+4 more)

### Community 57 - "Community 57"
Cohesion: 0.13
Nodes (10): ObservabilityOptions, buildRoot(), createLogger(), getRoot(), setRootLogger(), getMetricsRegistry(), labelKey(), Labels (+2 more)

### Community 58 - "Community 58"
Cohesion: 0.14
Nodes (14): buildAntigravityAgentEnv(), isAntigravityRuntimeConfigured(), parseAntigravityConnectionPayload(), ResolveAntigravityAuthOptions, resolveAntigravityOAuthToken(), AntigravityRuntimeOptions, AntigravityRuntimeProvider, CodexRuntimeOptions (+6 more)

### Community 59 - "Community 59"
Cohesion: 0.08
Nodes (25): dependencies, @anvio/core, ws, devDependencies, @types/ws, typescript, vitest, exports (+17 more)

### Community 60 - "Community 60"
Cohesion: 0.08
Nodes (24): dependencies, @anvio/core, yaml, devDependencies, typescript, vitest, exports, import (+16 more)

### Community 61 - "Community 61"
Cohesion: 0.08
Nodes (24): dependencies, yaml, zod, devDependencies, typescript, vitest, exports, import (+16 more)

### Community 63 - "Community 63"
Cohesion: 0.08
Nodes (24): dependencies, @anvio/core, yaml, devDependencies, typescript, vitest, exports, import (+16 more)

### Community 64 - "Community 64"
Cohesion: 0.08
Nodes (24): dependencies, @anvio/core, zod, devDependencies, typescript, vitest, exports, import (+16 more)

### Community 65 - "Community 65"
Cohesion: 0.15
Nodes (12): buildDefaultInputs(), callTool(), DagExecutor, renderTemplate(), TemplateContext, WorkflowExecutionDeps, WorkflowNodeResult, WorkflowRunOptions (+4 more)

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (23): dependencies, @anvio/core, yaml, devDependencies, typescript, vitest, exports, import (+15 more)

### Community 67 - "Community 67"
Cohesion: 0.09
Nodes (23): dependencies, @anvio/core, yaml, devDependencies, typescript, vitest, exports, import (+15 more)

### Community 68 - "Community 68"
Cohesion: 0.09
Nodes (22): dependencies, @anvio/core, devDependencies, typescript, vitest, exports, import, @anvio/core (+14 more)

### Community 69 - "Community 69"
Cohesion: 0.17
Nodes (11): buildClaudeCodeAgentEnv(), extractOAuthTokenFromSetupOutput(), parseClaudeCodeConnectionPayload(), ResolveClaudeCodeOAuthOptions, resolveClaudeCodeOAuthToken(), runClaudeSetupToken(), ClaudeCodeRuntimeOptions, ClaudeCodeRuntimeProvider (+3 more)

### Community 70 - "Community 70"
Cohesion: 0.10
Nodes (21): dependencies, @anvio/core, devDependencies, typescript, vitest, exports, import, @anvio/core (+13 more)

### Community 71 - "Community 71"
Cohesion: 0.13
Nodes (12): AgentInbox, ArtifactStore, CreateArtifactInput, AgentArtifact, ArtifactKind, InboxMessage, InboxMessageType, NotificationType (+4 more)

### Community 72 - "Community 72"
Cohesion: 0.16
Nodes (9): McpHandlerOptions, runMcpHandler(), runScriptHandler(), ScriptHandlerResult, runWebhookHandler(), WebhookHandlerOptions, HOOK_TO_SUBJECT, HookEngine (+1 more)

### Community 73 - "Community 73"
Cohesion: 0.23
Nodes (17): createModelProviderRegistryInstance(), ROUTE_PROVIDER_PREFERENCE, allKnownProviderIds(), isOpenAICompatibleProviderId(), MODEL_PROVIDER_IDS, ModelProviderId, NATIVE_PROVIDER_IDS, OPENAI_COMPATIBLE_PROVIDER_IDS (+9 more)

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (21): dependencies, @anvio/core, devDependencies, typescript, vitest, exports, import, @anvio/core (+13 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (21): dependencies, @anvio/core, devDependencies, typescript, vitest, exports, import, @anvio/core (+13 more)

### Community 76 - "Community 76"
Cohesion: 0.20
Nodes (11): AcpServer, createAcpServer(), readJson(), AcpErrorResponse, AcpHealthResponse, AcpPromptRequest, AcpPromptResponse, AcpRunHandler (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.27
Nodes (20): BUILTIN_CHANNELS, incrementHealthSummary(), isEnabled(), OPTIONAL_CHANNELS, probeAllChannels(), probeBuiltin(), probeDiscord(), probeEmail() (+12 more)

### Community 78 - "Community 78"
Cohesion: 0.12
Nodes (4): HarnessGateway, runSimulationScenario(), SimulatedMessage, SimulationTransport

### Community 79 - "Community 79"
Cohesion: 0.18
Nodes (6): buffer, drain(), handleMessage(), send(), TOOLS, McpStdioClient

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (12): createIntegrationRegistry(), IntegrationRegistry, createMcpBridge(), DEFAULT_STUB_TOOLS, McpServerHealth, McpToolCall, McpToolDescriptor, McpToolResult (+4 more)

### Community 81 - "Community 81"
Cohesion: 0.16
Nodes (11): createMcpFirstCallGate(), formatMcpToolName(), mcpApprovalKey(), McpFirstCallGate, McpFirstCallGateOptions, parseMcpToolName(), createMcpToolPort(), mapMcpStatus() (+3 more)

### Community 82 - "Community 82"
Cohesion: 0.14
Nodes (10): executeCode(), webSearch(), ToolCompletedHandler, ToolGateway, ToolGatewayCallContext, DEFAULT_DESCRIPTIONS, describeBuiltinTool(), renderToolInstructions() (+2 more)

### Community 83 - "Community 83"
Cohesion: 0.17
Nodes (8): isUsableModelProvider(), parseLlmJson(), SessionSummarizerOptions, SessionSummaryResult, formatSessionExcerpt(), LlmSkillProposal, SkillEvolutionProposal, SkillEvolutionSummarizer

### Community 84 - "Community 84"
Cohesion: 0.18
Nodes (10): extractGeminiText(), extractGeminiToolCalls(), GeminiContent, GeminiPart, toGeminiContents(), fetchMock, GeminiCandidate, GeminiGenerateResponse (+2 more)

### Community 85 - "Community 85"
Cohesion: 0.18
Nodes (11): recordStreamMetrics(), withCallMetrics(), extractToolCalls(), OpenAIChatCompletionResponse, OpenAICompatibleProvider, OpenAICompatibleProviderOptions, OpenAIToolCall, OpenAIToolCallDelta (+3 more)

### Community 86 - "Community 86"
Cohesion: 0.17
Nodes (13): createMock, streamMock, AnthropicMessage, ContentBlock, toAnthropicMessages(), AnthropicProvider, AnthropicProviderOptions, AnthropicUsage (+5 more)

### Community 87 - "Community 87"
Cohesion: 0.21
Nodes (5): OpenAiRealtimeSttOptions, OpenAiRealtimeSttSession, RealtimeSttSession, RealtimeTranscriptEvent, streamRealtimeTranscribe()

### Community 88 - "Community 88"
Cohesion: 0.18
Nodes (9): ExecutionAuditLog, CodeExecutorDeps, createCodeExecutor(), DefaultCodeExecutor, buildCommand(), ProcessSandboxOptions, ProcessSandboxResult, runDockerSandbox() (+1 more)

### Community 89 - "Community 89"
Cohesion: 0.16
Nodes (8): parseWhatsAppTarget(), splitMessage(), threadKey(), WhatsAppChannel, WhatsAppChannelOptions, WhatsAppInboundMessage, WhatsAppTarget, WhatsAppWebhookBody

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (14): bullets(), field(), parseSoulDefinitionMd(), sectionBody(), SoulEngine, parseSoulDefinition(), soulCommunicationStyleSchema, SoulDefinition (+6 more)

### Community 91 - "Community 91"
Cohesion: 0.20
Nodes (7): ApprovalGate, ApprovalGateOptions, approverMatchesSummary(), isAuthorizedApprover(), resolveApproversForSummary(), STOP_WORDS, tokenize()

### Community 93 - "Community 93"
Cohesion: 0.14
Nodes (8): CircuitBreakerOptions, CircuitState, ProviderCircuitBreaker, Slot, FallbackResult, RouteAttempt, walkFallbackChain(), WalkFallbackOptions

### Community 94 - "Community 94"
Cohesion: 0.20
Nodes (7): buildCodexAgentEnv(), isCodexRuntimeConfigured(), parseCodexAuthJson(), prepareCodexAuthHome(), resolveCodexAuthJson(), ResolveCodexAuthOptions, CodexRuntimeProvider

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (17): @anvio/agents, @anvio/execution, @anvio/goals, dependencies, @anvio/agents, @anvio/blueprints, @anvio/execution, @anvio/goals (+9 more)

### Community 96 - "Community 96"
Cohesion: 0.20
Nodes (7): parseSlackTarget(), SlackChannel, SlackChannelOptions, SlackMessageEvent, SlackSocketEnvelope, SlackTarget, threadKey()

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (14): BlueprintDefinition, blueprintDefinitionSchema, blueprintInputSchema, BlueprintSpec, blueprintSpecSchema, BlueprintStep, blueprintStepSchema, workflowDefinitionSchema (+6 more)

### Community 98 - "Community 98"
Cohesion: 0.20
Nodes (6): harnessToolDefinitions(), createHarnessAwareToolPort(), filterForToolSurface(), HarnessAwareToolPort, HarnessBuiltinToolCaller, mcpAndChannelOnly()

### Community 99 - "Community 99"
Cohesion: 0.19
Nodes (4): RemoteExecResult, RemoteRuntimeStubOptions, SingularityRuntimeOptions, SingularityRuntimeProvider

### Community 100 - "Community 100"
Cohesion: 0.19
Nodes (3): AutomationEngine, AutomationEventBus, AutomationRegistry

### Community 101 - "Community 101"
Cohesion: 0.14
Nodes (13): agentApprovalsSchema, agentDefinitionSchema, agentMemorySchema, agentModelSchema, agentOrchestrationSchema, agentRuntimeBindingSchema, AgentSpec, agentSpecSchema (+5 more)

### Community 102 - "Community 102"
Cohesion: 0.25
Nodes (9): formatForChannel(), markdownToDiscord(), markdownToPlain(), markdownToSlackMrkdwn(), markdownToTelegramHtml(), createHarnessOutputPort(), createHarnessToolHandlers(), HarnessOutputPortImpl (+1 more)

### Community 103 - "Community 103"
Cohesion: 0.20
Nodes (3): DaytonaRuntimeProvider, ModalRuntimeProvider, RemoteRuntimeStub

### Community 104 - "Community 104"
Cohesion: 0.19
Nodes (5): CacheEntry, SkillTriggerCache, matchTriggers(), mergeSkillSlugs(), TriggerMatchContext

### Community 105 - "Community 105"
Cohesion: 0.18
Nodes (5): createSkillCatalogResolver(), SkillCatalogPaths, SkillCatalogResolver, createSkillInstaller(), InstalledSkillManifest

### Community 107 - "Community 107"
Cohesion: 0.13
Nodes (14): dist, node_modules, **/*.spec.ts, compilerOptions, declaration, declarationMap, outDir, rootDir (+6 more)

### Community 108 - "Community 108"
Cohesion: 0.24
Nodes (5): hasCursorCliSession(), isCursorRuntimeConfigured(), parseCursorConnectionPayload(), ResolveCursorSessionOptions, CursorRuntimeProvider

### Community 109 - "Community 109"
Cohesion: 0.19
Nodes (4): CodexRuntimeProvider, CursorRuntimeProvider, ExternalRuntimeOptions, ExternalRuntimeStub

### Community 111 - "Community 111"
Cohesion: 0.26
Nodes (7): ChannelVoiceDeps, ChannelVoiceOptions, isChannelVoiceEnabled(), transcribeInboundAudio(), voiceInboundContent(), VoicePipeline, VoiceTurnResult

### Community 112 - "Community 112"
Cohesion: 0.15
Nodes (3): JwtAuthProvider, NoAuthProvider, OAuth2AuthProvider

### Community 113 - "Community 113"
Cohesion: 0.18
Nodes (6): PlanExecuteReviewEngine, PlannerConfig, PlannerPhase, PlannerPhaseResult, PlannerRunInput, PlannerRunner

### Community 114 - "Community 114"
Cohesion: 0.18
Nodes (3): LongTermMemoryPort, ShortTermMemoryPort, CompositeMemoryStore

### Community 115 - "Community 115"
Cohesion: 0.19
Nodes (3): FilesystemSoulStore, renderSoulMd(), FilesystemStorageProvider

### Community 116 - "Community 116"
Cohesion: 0.34
Nodes (11): decideToolCall(), escapeRegex(), LayeredPolicy, matches(), mergeToolPolicies(), POLICY_LAYER_ORDER, PolicyDecision, PolicyLayer (+3 more)

### Community 117 - "Community 117"
Cohesion: 0.27
Nodes (12): haCallService(), haConfig(), haFail(), haFetch(), haGetState(), haListEntities(), haListServices(), buildSimpleDiff() (+4 more)

### Community 120 - "Community 120"
Cohesion: 0.35
Nodes (3): IntegrationEntry, McpBridge, usesStdioTransport()

### Community 123 - "Community 123"
Cohesion: 0.21
Nodes (7): createRealtimeSttSession(), ChunkedStreamingSttSession, CreateStreamingSttOptions, createStreamingSttSession(), StreamingSttChunk, StreamingSttSession, streamTranscribe()

### Community 126 - "Community 126"
Cohesion: 0.21
Nodes (8): RuntimeToolContext, BuiltinToolCall, BuiltinToolResult, ToolGatewayConfig, toolGatewayConfigSchema, ToolGatewaySpec, toolGatewaySpecSchema, toolGatewayToolSchema

### Community 127 - "Community 127"
Cohesion: 0.17
Nodes (9): HarnessChannelProfile, harnessChannelProfileSchema, HarnessConfig, harnessConfigSchema, harnessDefaultsSchema, harnessEngageTriggerSchema, HarnessProfilesConfig, harnessProfilesSchema (+1 more)

### Community 128 - "Community 128"
Cohesion: 0.27
Nodes (9): createMemoryProviderFromConfig(), createMemoryStore(), createMemoryProvider(), createStubProvider(), fallbackSummary(), FilesystemMemoryOptions, SummarizerFn, createHonchoProvider() (+1 more)

### Community 129 - "Community 129"
Cohesion: 0.24
Nodes (4): openSqliteFtsRecall(), SqliteFtsDb, SqliteFtsRecall, RecallHit

### Community 130 - "Community 130"
Cohesion: 0.17
Nodes (11): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*, ../../tsconfig.base.json (+3 more)

### Community 132 - "Community 132"
Cohesion: 0.18
Nodes (9): ProviderRouting, providerRoutingSchema, providerRoutingSpecSchema, RouteDefinition, routeDefinitionSchema, RouteTarget, routeTargetSchema, RoutingStrategy (+1 more)

### Community 133 - "Community 133"
Cohesion: 0.20
Nodes (9): defaultSoulPolicy(), parseSoulPolicy(), SoulPolicy, SoulPolicyApprover, soulPolicyApproverSchema, soulPolicyIdentitySchema, soulPolicySchema, soulPolicyUserRefSchema (+1 more)

### Community 136 - "Community 136"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*, src/**/*.spec.ts (+2 more)

### Community 137 - "Community 137"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*, src/**/*.spec.ts (+2 more)

### Community 138 - "Community 138"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*, src/**/*.spec.ts (+2 more)

### Community 140 - "Community 140"
Cohesion: 0.27
Nodes (4): extensionForMime(), OpenAiSpeechAdapter, SpeechToTextAdapter, TextToSpeechAdapter

### Community 141 - "Community 141"
Cohesion: 0.38
Nodes (8): CronField, cronMatches(), DOW, matchesField(), nextCronRuns(), parseCronExpression(), parseDowField(), parseField()

### Community 144 - "Community 144"
Cohesion: 0.24
Nodes (3): RuntimeToolPort, loadMcpToolCatalog(), McpToolPort

### Community 145 - "Community 145"
Cohesion: 0.20
Nodes (8): AutomationAction, automationActionSchema, AutomationDefinition, automationDefinitionSchema, automationRetrySchema, automationSpecSchema, AutomationTrigger, automationTriggerSchema

### Community 146 - "Community 146"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*.spec.ts, ../../tsconfig.base.json (+1 more)

### Community 148 - "Community 148"
Cohesion: 0.31
Nodes (8): CostEstimateInput, DESCRIPTORS, estimateModelCostUsd(), getModelDescriptor(), INDEX, listModelDescriptors(), ModelCost, ModelDescriptor

### Community 149 - "Community 149"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, exclude, extends, include, src/**/*, src/**/*.spec.ts (+1 more)

### Community 150 - "Community 150"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 151 - "Community 151"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 152 - "Community 152"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 153 - "Community 153"
Cohesion: 0.31
Nodes (5): ActionExecutionContext, ActionExecutionResult, ActionExecutor, ActionExecutorDeps, sleep()

### Community 154 - "Community 154"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 155 - "Community 155"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 156 - "Community 156"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 158 - "Community 158"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 159 - "Community 159"
Cohesion: 0.22
Nodes (7): hookBindingSchema, HookEventName, hookEventNameSchema, HookHandler, hookHandlerSchema, HookRegistry, hookRegistrySchema

### Community 160 - "Community 160"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 161 - "Community 161"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 162 - "Community 162"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 163 - "Community 163"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 164 - "Community 164"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 165 - "Community 165"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 166 - "Community 166"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 167 - "Community 167"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 169 - "Community 169"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 170 - "Community 170"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 171 - "Community 171"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 172 - "Community 172"
Cohesion: 0.25
Nodes (8): exports, import, main, name, private, type, types, version

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 175 - "Community 175"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 176 - "Community 176"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 177 - "Community 177"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 178 - "Community 178"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 179 - "Community 179"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 180 - "Community 180"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*, ../../tsconfig.base.json, references

### Community 181 - "Community 181"
Cohesion: 0.25
Nodes (7): HarnessApprovalContext, HarnessApprovalMessage, HarnessOutputAction, HarnessOutputRequest, HarnessTrustTier, InboundDecision, InboundGateResult

### Community 183 - "Community 183"
Cohesion: 0.29
Nodes (3): FACT_PATTERNS, MemoryNudgeEngine, MemoryNudgeResult

### Community 184 - "Community 184"
Cohesion: 0.25
Nodes (4): ToolAuditLogger, ToolExecutionInput, ToolExecutionResult, ToolExecutor

### Community 185 - "Community 185"
Cohesion: 0.25
Nodes (5): KnowledgeBaseDefinition, knowledgeBaseDefinitionSchema, knowledgeBaseSpecSchema, KnowledgeManifest, knowledgeManifestSchema

### Community 186 - "Community 186"
Cohesion: 0.32
Nodes (3): EngagementStore, MemoryEngagementStore, HarnessGatewayOptions

### Community 187 - "Community 187"
Cohesion: 0.36
Nodes (5): LearningEngineOptions, SessionLearningInput, SessionLearningResult, SessionSummaryJobResult, StaleSessionInput

### Community 189 - "Community 189"
Cohesion: 0.32
Nodes (3): renderSkillMd(), SkillDraftInput, SkillEvolutionWriter

### Community 190 - "Community 190"
Cohesion: 0.43
Nodes (3): MemoryRecallIndex, scoreOverlap(), tokenize()

### Community 193 - "Community 193"
Cohesion: 0.33
Nodes (3): AutomationEngineOptions, matchesFilter(), AutomationRunState

### Community 194 - "Community 194"
Cohesion: 0.29
Nodes (5): CodeExecutionRequest, CodeExecutionResult, CodeExecutor, CodeRuntime, ExecutionAuditRecord

### Community 198 - "Community 198"
Cohesion: 0.29
Nodes (7): devDependencies, @types/ws, typescript, vitest, @types/ws, typescript, vitest

### Community 199 - "Community 199"
Cohesion: 0.53
Nodes (5): expectCode(), readResponse(), sendLine(), sendSmtpMail(), SmtpSendOptions

### Community 201 - "Community 201"
Cohesion: 0.33
Nodes (4): ConnectionGrant, connectionGrantSchema, StoredConnection, storedConnectionSchema

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (4): McpConfig, mcpConfigSchema, McpServerSpec, mcpServerSpecSchema

### Community 210 - "Community 210"
Cohesion: 0.40
Nodes (3): ChannelHealthProbe, ChannelHealthReport, ChannelHealthState

### Community 211 - "Community 211"
Cohesion: 0.60
Nodes (4): applyMcpPreset(), listMcpPresets(), parsePresetServers(), presetPath()

### Community 212 - "Community 212"
Cohesion: 0.40
Nodes (5): scripts, build, clean, test, typecheck

## Knowledge Gaps
- **1160 isolated node(s):** `name`, `version`, `private`, `type`, `main` (+1155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **58 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buffer` connect `Community 79` to `Community 0`, `Community 4`, `Community 134`, `Community 12`, `Community 140`, `Community 17`, `Community 28`, `Community 36`, `Community 39`, `Community 51`, `Community 58`, `Community 69`, `Community 199`, `Community 72`, `Community 76`, `Community 87`, `Community 88`, `Community 111`, `Community 117`, `Community 123`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `createPlatform()` connect `Community 0` to `Community 65`, `Community 196`, `Community 187`, `Community 82`, `Community 20`, `Community 27`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `SessionStore` connect `Community 142` to `Community 27`, `Community 13`, `Community 110`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _1160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05311871227364185 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06954887218045112 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0632996632996633 - nodes in this community are weakly interconnected._