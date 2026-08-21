/**
 * Every model id this repo names in code, descriptors, or scaffolded config.
 *
 * Model ids were previously restated as string literals across eight files, so a
 * rotation meant a grep and a typo meant a 404 nobody noticed until a call failed.
 * Import from here instead; the accompanying spec asserts that descriptors,
 * provider defaults, and the `anvio init` scaffold all resolve to these values.
 *
 * Prefer undated aliases: they track the latest snapshot and are what users write
 * in agent frontmatter.
 */
export const MODEL_IDS = {
  anthropicSonnet4: 'claude-sonnet-4-20250514',
  anthropicOpus4: 'claude-opus-4-20250514',
  anthropicHaiku45: 'claude-haiku-4-5',
  geminiFlash20: 'gemini-2.0-flash',
  geminiPro15: 'gemini-1.5-pro',
  openaiGpt4o: 'gpt-4o',
  openaiGpt4oMini: 'gpt-4o-mini',
  deepseekChat: 'deepseek-chat',
  groqLlama33: 'llama-3.3-70b-versatile',
} as const;

/**
 * Defaults applied when neither the request nor agent frontmatter names a model.
 *
 * `anthropic` is a deprecated dated snapshot. It still resolves, and every real
 * caller supplies an explicit model (`packages/agents/src/runtime.ts` forwards
 * `agent.spec.model.model`, which `agent-md.ts` always populates), so this is a
 * rarely-taken branch. Rotating it is now a one-line change here rather than a
 * sweep — but it is a live behaviour and cost change for every existing
 * workspace, so it is deliberately left as an explicit decision.
 */
export const DEFAULT_MODELS = {
  anthropic: MODEL_IDS.anthropicSonnet4,
  gemini: MODEL_IDS.geminiFlash20,
} as const;

export const KNOWN_MODEL_IDS: ReadonlySet<string> = new Set(Object.values(MODEL_IDS));

/**
 * Anthropic ids that return 404. Referencing one is always a bug, whether it
 * reached the repo as a stale default or as a typo — the scaffolded routing.yaml
 * shipped `claude-haiku-3-5-20241022`, which reversed the family and version
 * segments of an already-retired id and so matched nothing in any generation.
 */
export const RETIRED_ANTHROPIC_MODEL_IDS: ReadonlySet<string> = new Set([
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-sonnet-20240229',
  'claude-2.1',
  'claude-2.0',
]);
