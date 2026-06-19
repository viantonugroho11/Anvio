import type { WorkerLane } from '@anvio/core';

export interface AgentCapability {
  id: string;
  skills: string[];
}

export class LaneRouter {
  constructor(
    private readonly lanes: WorkerLane[],
    private readonly agents: AgentCapability[],
  ) {}

  findLane(slug: string): WorkerLane | undefined {
    return this.lanes.find((lane) => lane.metadata.slug === slug);
  }

  findCapableAgents(requiredSkills: string[], preferredAgents: string[] = []): string[] {
    const capable = this.agents.filter((agent) =>
      requiredSkills.every((skill) => agent.skills.includes(skill)),
    );

    if (preferredAgents.length > 0) {
      const preferred = capable.filter((a) => preferredAgents.includes(a.id));
      if (preferred.length > 0) {
        return preferred.map((a) => a.id);
      }
    }

    return capable.map((a) => a.id);
  }

  resolveAgentForLane(laneSlug: string, requiredSkills: string[] = []): string | null {
    const lane = this.findLane(laneSlug);
    const skills = lane?.spec.requiredSkills.length
      ? lane.spec.requiredSkills
      : requiredSkills;
    const preferred = lane?.spec.preferredAgents ?? [];
    const agents = this.findCapableAgents(skills, preferred);
    return agents[0] ?? null;
  }
}

export function defaultAgentCapabilities(): AgentCapability[] {
  return [
    { id: 'researcher', skills: ['research', 'planning'] },
    { id: 'architect', skills: ['architecture', 'planning', 'research'] },
    { id: 'software-engineer', skills: ['coding', 'debugging'] },
    { id: 'code-reviewer', skills: ['code-review'] },
    { id: 'qa-agent', skills: ['testing', 'qa'] },
    { id: 'technical-writer', skills: ['documentation'] },
  ];
}

export function defaultWorkerLanes(): WorkerLane[] {
  return [
    {
      apiVersion: 'anvio.io/v1',
      kind: 'WorkerLane',
      metadata: { slug: 'research' },
      spec: {
        description: 'Research and planning',
        requiredSkills: ['research'],
        preferredAgents: ['researcher', 'architect'],
        autoAssign: true,
        concurrency: 2,
      },
    },
    {
      apiVersion: 'anvio.io/v1',
      kind: 'WorkerLane',
      metadata: { slug: 'coding' },
      spec: {
        description: 'Implementation and code changes',
        requiredSkills: ['coding'],
        preferredAgents: ['software-engineer'],
        autoAssign: true,
        concurrency: 2,
      },
    },
    {
      apiVersion: 'anvio.io/v1',
      kind: 'WorkerLane',
      metadata: { slug: 'review' },
      spec: {
        description: 'Code review',
        requiredSkills: ['code-review'],
        preferredAgents: ['code-reviewer'],
        autoAssign: true,
        concurrency: 1,
      },
    },
  ];
}
