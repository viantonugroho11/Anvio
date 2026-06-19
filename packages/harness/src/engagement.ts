import type { HarnessChannelProfile } from '@anvio/core';

export interface EngagementState {
  channel: string;
  threadId: string;
  engaged: boolean;
  updatedAt: string;
}

export interface EngagementStore {
  get(channel: string, threadId: string): Promise<EngagementState | null>;
  set(state: EngagementState): Promise<void>;
}

export class MemoryEngagementStore implements EngagementStore {
  private readonly states = new Map<string, EngagementState>();

  private key(channel: string, threadId: string): string {
    return `${channel}:${threadId}`;
  }

  async get(channel: string, threadId: string): Promise<EngagementState | null> {
    return this.states.get(this.key(channel, threadId)) ?? null;
  }

  async set(state: EngagementState): Promise<void> {
    this.states.set(this.key(state.channel, state.threadId), state);
  }
}

export function evaluateEngagement(
  profile: HarnessChannelProfile,
  current: EngagementState | null,
  input: { mentionedBot?: boolean; mentionedOther?: boolean },
): boolean {
  let engaged = current?.engaged ?? profile.engageOn === 'always';

  if (profile.engageOn === 'mention' && input.mentionedBot) {
    engaged = true;
  }
  if (profile.disengageOn === 'mention_other' && input.mentionedOther) {
    engaged = false;
  }
  return engaged;
}
