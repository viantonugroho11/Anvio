/** Built-in OpenAI-compatible API providers (chat/completions). */
export interface OpenAICompatibleProviderSpec {
  id: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: string;
  extraHeaders?: Record<string, string>;
  /** Register without API key (local inference). */
  optionalApiKey?: boolean;
}

export const OPENAI_COMPATIBLE_PROVIDER_SPECS: Record<string, OpenAICompatibleProviderSpec> = {
  openai: {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER ?? 'https://anvio.local',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Anvio',
    },
  },
  deepseek: {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  groq: {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  mistral: {
    id: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  together: {
    id: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
  xai: {
    id: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    apiKeyEnv: 'XAI_API_KEY',
  },
  fireworks: {
    id: 'fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    apiKeyEnv: 'FIREWORKS_API_KEY',
  },
  moonshot: {
    id: 'moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  cerebras: {
    id: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    apiKeyEnv: 'CEREBRAS_API_KEY',
  },
  sambanova: {
    id: 'sambanova',
    baseUrl: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.1-70B-Instruct',
    apiKeyEnv: 'SAMBANOVA_API_KEY',
  },
  perplexity: {
    id: 'perplexity',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
  },
  cohere: {
    id: 'cohere',
    baseUrl: 'https://api.cohere.com/v2',
    defaultModel: 'command-r-plus-08-2024',
    apiKeyEnv: 'COHERE_API_KEY',
  },
  huggingface: {
    id: 'huggingface',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    defaultModel: 'meta-llama/Llama-3.2-3B-Instruct',
    apiKeyEnv: 'HF_TOKEN',
  },
  ollama: {
    id: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
    apiKeyEnv: 'OLLAMA_API_KEY',
    optionalApiKey: true,
  },
};

/** Non–OpenAI-compatible built-ins. */
export const NATIVE_PROVIDER_IDS = ['anthropic', 'gemini'] as const;

export const OPENAI_COMPATIBLE_PROVIDER_IDS = Object.keys(
  OPENAI_COMPATIBLE_PROVIDER_SPECS,
) as Array<keyof typeof OPENAI_COMPATIBLE_PROVIDER_SPECS>;

export const MODEL_PROVIDER_IDS = [
  ...NATIVE_PROVIDER_IDS,
  ...OPENAI_COMPATIBLE_PROVIDER_IDS,
  'custom',
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

export function isOpenAICompatibleProviderId(id: string): id is keyof typeof OPENAI_COMPATIBLE_PROVIDER_SPECS {
  return id in OPENAI_COMPATIBLE_PROVIDER_SPECS;
}

export function resolveApiKeyFromEnv(spec: OpenAICompatibleProviderSpec): string | undefined {
  return process.env[spec.apiKeyEnv];
}

export function allKnownProviderIds(): ModelProviderId[] {
  return MODEL_PROVIDER_IDS.filter((id) => id !== 'custom');
}
