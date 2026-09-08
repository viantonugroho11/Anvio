import type { AgentCard } from '../types/agent-card.js';

/**
 * Discovers and caches remote A2A Agent Cards.
 * Fetches from /.well-known/agent.json per the A2A spec.
 */
export class AgentDiscovery {
  private readonly cache = new Map<string, { card: AgentCard; fetchedAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async discover(baseUrl: string): Promise<AgentCard> {
    const cached = this.cache.get(baseUrl);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.card;
    }

    const url = `${baseUrl.replace(/\/$/, '')}/.well-known/agent.json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Agent Card fetch failed: ${res.status} ${res.statusText} from ${url}`);
    }

    const card = (await res.json()) as AgentCard;
    this.cache.set(baseUrl, { card, fetchedAt: Date.now() });
    return card;
  }

  async discoverAll(baseUrl: string): Promise<AgentCard[]> {
    const url = `${baseUrl.replace(/\/$/, '')}/.well-known/agents.json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      // Fall back to single agent card
      const single = await this.discover(baseUrl);
      return [single];
    }

    return (await res.json()) as AgentCard[];
  }

  invalidate(baseUrl: string): void {
    this.cache.delete(baseUrl);
  }

  clear(): void {
    this.cache.clear();
  }
}
