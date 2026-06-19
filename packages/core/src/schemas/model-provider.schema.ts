import { z } from 'zod';

/** Keep in sync with @anvio/models provider-catalog. */
export const MODEL_PROVIDER_IDS = [
  'anthropic',
  'gemini',
  'openai',
  'openrouter',
  'deepseek',
  'groq',
  'mistral',
  'together',
  'xai',
  'fireworks',
  'moonshot',
  'cerebras',
  'sambanova',
  'perplexity',
  'cohere',
  'huggingface',
  'ollama',
  'custom',
] as const;

export const modelProviderIdSchema = z.enum(MODEL_PROVIDER_IDS);

export type ModelProviderId = z.infer<typeof modelProviderIdSchema>;
