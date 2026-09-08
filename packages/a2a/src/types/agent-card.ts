/** A2A v1.0 Agent Card — discovery metadata for an A2A-compliant agent. */

export interface AgentCard {
  agentId: string;
  agentName: string;
  description?: string;
  provider?: AgentProvider;
  capabilities: AgentCapabilities;
  endpoints: AgentInterface[];
  skills?: AgentSkill[];
  extensions?: AgentExtension[];
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
  metadata?: Record<string, unknown>;
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  extendedAgentCard: boolean;
}

export type ProtocolBinding = 'json-rpc' | 'grpc' | 'http+json';

export interface AgentInterface {
  url: string;
  protocolBinding: ProtocolBinding;
  tenant?: string;
}

export interface AgentSkill {
  skillId: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  acceptedMimeTypes?: string[];
  outputMimeTypes?: string[];
}

export interface AgentExtension {
  uri: string;
  version: string;
  required?: boolean;
  metadata?: Record<string, unknown>;
}

export type SecurityScheme =
  | ApiKeySecurityScheme
  | HttpAuthSecurityScheme
  | OAuth2SecurityScheme
  | OpenIdConnectSecurityScheme
  | MutualTlsSecurityScheme;

export interface ApiKeySecurityScheme {
  type: 'apiKey';
  name: string;
  in: 'header' | 'query';
}

export interface HttpAuthSecurityScheme {
  type: 'http';
  scheme: string;
}

export interface OAuth2SecurityScheme {
  type: 'oauth2';
  flows: OAuthFlows;
  refreshUrl?: string;
}

export interface OAuthFlows {
  authorizationCode?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: Record<string, string>;
  };
  clientCredentials?: {
    tokenUrl: string;
    scopes: Record<string, string>;
  };
}

export interface OpenIdConnectSecurityScheme {
  type: 'openIdConnect';
  openIdConnectUrl: string;
}

export interface MutualTlsSecurityScheme {
  type: 'mutualTLS';
}
