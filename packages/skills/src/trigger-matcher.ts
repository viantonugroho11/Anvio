import type { SkillDefinition } from '@anvio/core';

export interface TriggerMatchContext {
  /** Active channel identifier, e.g. "telegram", "slack", "github" */
  channel?: string;
  /** Event type from channel metadata, e.g. "pull_request", "message" */
  event?: string;
}

/**
 * Return the slugs of skills whose triggers[] match the inbound message.
 * String triggers: case-insensitive substring match against message text.
 * Object triggers: match event + optional channel.
 */
export function matchTriggers(
  message: string,
  skills: SkillDefinition[],
  matchCtx: TriggerMatchContext = {},
): string[] {
  const matched: string[] = [];
  const lowerMsg = message.toLowerCase();

  for (const skill of skills) {
    if (!skill.spec.triggers.length) continue;

    for (const trigger of skill.spec.triggers) {
      if (typeof trigger === 'string') {
        if (lowerMsg.includes(trigger.toLowerCase())) {
          matched.push(skill.metadata.slug);
          break;
        }
      } else {
        // Object trigger: { event, condition?, channel? }
        const eventMatch = !matchCtx.event || trigger.event === matchCtx.event;
        const channelMatch = !trigger.channel || trigger.channel === matchCtx.channel;
        if (eventMatch && channelMatch) {
          matched.push(skill.metadata.slug);
          break;
        }
      }
    }
  }

  return matched;
}

/**
 * Merge auto-activated skill slugs into an existing list, deduplicating.
 */
export function mergeSkillSlugs(existing: string[], autoActivated: string[]): string[] {
  const set = new Set(existing);
  for (const slug of autoActivated) set.add(slug);
  return [...set];
}
