import { AnvioError } from '@anvio/core';
import type { ModelProvider } from '@anvio/core';
import {
  isOpenAICompatibleProviderId,
  OPENAI_COMPATIBLE_PROVIDER_SPECS,
  resolveApiKeyFromEnv,
} from './provider-catalog.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { GeminiProvider } from './providers/gemini.provider.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider.js';

export interface CreateModelProviderOptions {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

function createOpenAICompatibleFromSpec(
  specId: keyof typeof OPENAI_COMPATIBLE_PROVIDER_SPECS,
  options: CreateModelProviderOptions,
): ModelProvider {
  const spec = OPENAI_COMPATIBLE_PROVIDER_SPECS[specId];
  const apiKey =
    options.apiKey ??
    (spec.optionalApiKey ? undefined : resolveApiKeyFromEnv(spec));

  if (!apiKey && !spec.optionalApiKey) {
    throw new AnvioError('VALIDATION_ERROR', `${spec.id} provider requires apiKey`);
  }

  let baseUrl = options.baseUrl ?? spec.baseUrl;
  if (specId === 'ollama') {
    const raw = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    baseUrl = raw.endsWith('/v1') ? raw : `${raw.replace(/\/$/, '')}/v1`;
  }

  return new OpenAICompatibleProvider({
    providerId: spec.id,
    apiKey,
    baseUrl,
    defaultModel: options.model ?? spec.defaultModel,
    extraHeaders: spec.extraHeaders,
  });
}

export function createModelProvider(
  providerOrOptions: string | CreateModelProviderOptions,
  apiKey?: string,
  model?: string,
): ModelProvider {
  const options: CreateModelProviderOptions =
    typeof providerOrOptions === 'string'
      ? { provider: providerOrOptions, apiKey, model }
      : providerOrOptions;

  const provider = options.provider;

  switch (provider) {
    case 'anthropic': {
      const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new AnvioError('VALIDATION_ERROR', 'Anthropic provider requires apiKey');
      }
      return new AnthropicProvider({
        apiKey: key,
        defaultModel: options.model ?? 'claude-sonnet-4-20250514',
      });
    }
    case 'gemini': {
      const key =
        options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (!key) {
        throw new AnvioError('VALIDATION_ERROR', 'Gemini provider requires apiKey');
      }
      return new GeminiProvider({
        apiKey: key,
        defaultModel: options.model ?? 'gemini-2.0-flash',
        baseUrl: options.baseUrl,
      });
    }
    case 'custom': {
      if (!options.baseUrl) {
        throw new AnvioError('VALIDATION_ERROR', 'custom provider requires baseUrl');
      }
      const key =
        options.apiKey ??
        (process.env.CUSTOM_API_KEY ||
          (process.env.CUSTOM_OPENAI_API_KEY ? process.env.CUSTOM_OPENAI_API_KEY : undefined));
      return new OpenAICompatibleProvider({
        providerId: 'custom',
        apiKey: key,
        baseUrl: options.baseUrl,
        defaultModel: options.model ?? 'default',
      });
    }
    default:
      break;
  }

  if (isOpenAICompatibleProviderId(provider)) {
    return createOpenAICompatibleFromSpec(provider, options);
  }

  throw new AnvioError('VALIDATION_ERROR', `Unsupported provider: ${options.provider}`);
}

export interface ModelProviderRegistryOptions {
  anthropicApiKey?: string;
  apiKeys?: Partial<Record<string, string>>;
  ollamaBaseUrl?: string | false;
  defaults?: Partial<Record<string, string>>;
}

export function createModelProviderRegistry(
  options: ModelProviderRegistryOptions = {},
): Map<string, ModelProvider> {
  const providers = new Map<string, ModelProvider>();
  const defaults = options.defaults ?? {};

  const anthropicKey = options.anthropicApiKey ?? options.apiKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    providers.set(
      'anthropic',
      createModelProvider({ provider: 'anthropic', apiKey: anthropicKey, model: defaults.anthropic }),
    );
  }

  const geminiKey =
    options.apiKeys?.gemini ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    providers.set(
      'gemini',
      createModelProvider({ provider: 'gemini', apiKey: geminiKey, model: defaults.gemini }),
    );
  }

  for (const [id, spec] of Object.entries(OPENAI_COMPATIBLE_PROVIDER_SPECS)) {
    if (id === 'ollama') continue;

    const key = options.apiKeys?.[id] ?? resolveApiKeyFromEnv(spec);
    if (key) {
      providers.set(
        id,
        createModelProvider({ provider: id, apiKey: key, model: defaults[id] }),
      );
    }
  }

  if (options.ollamaBaseUrl !== false) {
    const resolved =
      typeof options.ollamaBaseUrl === 'string'
        ? options.ollamaBaseUrl
        : process.env.OLLAMA_BASE_URL;
    if (resolved || process.env.OLLAMA_ENABLED === 'true') {
      providers.set(
        'ollama',
        createModelProvider({
          provider: 'ollama',
          baseUrl: resolved,
          model: defaults.ollama,
        }),
      );
    }
  }

  return providers;
}

export function createModelProviderRegistryFromEnv(
  overrides: ModelProviderRegistryOptions = {},
): Map<string, ModelProvider> {
  return createModelProviderRegistry({
    ...overrides,
    ollamaBaseUrl:
      overrides.ollamaBaseUrl ??
      (process.env.OLLAMA_DISABLED === 'true' ? false : process.env.OLLAMA_BASE_URL),
  });
}
