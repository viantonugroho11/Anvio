import fs from 'node:fs/promises';
import path from 'node:path';
import type { HarnessChannelProfile } from '@anvio/core';

export interface EngagementState {
  channel: string;
  threadId: string;
  engaged: boolean;
  updatedAt: string;
  /** `/1on1` lock: only this user can steer the thread while set. */
  owner?: { userId: string; since: string };
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

/**
 * Level 1 persistent store: one JSON file per thread under `<root>/<channel>/`.
 * Survives gateway restarts without a database.
 */
export class FilesystemEngagementStore implements EngagementStore {
  constructor(private readonly root: string) {}

  private file(channel: string, threadId: string): string {
    return path.join(this.root, encodeURIComponent(channel), `${encodeURIComponent(threadId)}.json`);
  }

  async get(channel: string, threadId: string): Promise<EngagementState | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(channel, threadId), 'utf-8')) as EngagementState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(state: EngagementState): Promise<void> {
    const file = this.file(state.channel, state.threadId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, file);
  }
}

export function evaluateEngagement(
  profile: HarnessChannelProfile,
  current: EngagementState | null,
  input: { mentionedBot?: boolean; mentionedOther?: boolean; senderId?: string },
): boolean {
  if (current?.owner) {
    // Locked thread: the owner is always engaged, everyone else is ignored
    // (their mentions of other people must not disengage the owner's thread).
    return input.senderId === current.owner.userId;
  }

  let engaged = current?.engaged ?? profile.engageOn === 'always';

  if (profile.engageOn === 'mention' && input.mentionedBot) {
    engaged = true;
  }
  if (profile.disengageOn === 'mention_other' && input.mentionedOther) {
    engaged = false;
  }
  return engaged;
}
