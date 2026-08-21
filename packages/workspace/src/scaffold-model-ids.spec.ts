import { describe, expect, it } from 'vitest';
import { KNOWN_MODEL_IDS, RETIRED_ANTHROPIC_MODEL_IDS } from '@anvio/core';
import { defaultRoutingYaml } from './index.js';

/** Every `model: <id>` line the scaffolded routing.yaml emits. */
function scaffoldModelIds(): string[] {
  return [...defaultRoutingYaml().matchAll(/^\s*model:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
}

describe('scaffolded routing.yaml model ids', () => {
  it('emits at least one model per route', () => {
    expect(scaffoldModelIds().length).toBeGreaterThanOrEqual(3);
  });

  it('names only ids the repo knows', () => {
    // The scaffold previously shipped `claude-haiku-3-5-20241022` on every
    // `anvio init` — a reversed-segment spelling of an already-retired id, so it
    // matched no model in any generation and the chat route 404'd on first use.
    for (const id of scaffoldModelIds()) {
      expect(KNOWN_MODEL_IDS.has(id), `unknown model id in scaffold: ${id}`).toBe(true);
    }
  });

  it('names no retired Anthropic model', () => {
    for (const id of scaffoldModelIds()) {
      expect(RETIRED_ANTHROPIC_MODEL_IDS.has(id), `retired model id in scaffold: ${id}`).toBe(
        false,
      );
    }
  });

  it('gives every route a fallback target', () => {
    // A route whose primary fails with no fallback is a hard failure; the chat
    // route shipped without one.
    const yaml = defaultRoutingYaml();
    const routeBlocks = yaml.split(/^\s{4}\w+:$/m).slice(1);
    expect(routeBlocks.length).toBeGreaterThan(0);
    for (const block of routeBlocks) {
      expect(block).toContain('fallback:');
    }
  });
});
