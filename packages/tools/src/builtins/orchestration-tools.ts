export type DelegateTaskFn = (input: {
  agent: string;
  task: string;
  context?: string;
}) => Promise<{ sessionId: string; content: string; status: string }>;

export type CronjobFn = (input: {
  action: 'list' | 'run' | 'create';
  slug?: string;
  schedule?: string;
  agent?: string;
  prompt?: string;
  timezone?: string;
}) => Promise<unknown>;

export type ListSkillsFn = () => Promise<string[]>;

export type GetSkillFn = (slug: string) => Promise<{
  slug: string;
  name: string;
  description: string;
  instructions: string;
}>;

export type SendMessageFn = (input: {
  message: string;
  channel?: string;
  sessionId?: string;
}) => Promise<{ ok: boolean }>;

export type MixtureOfAgentsFn = (input: {
  task: string;
  agents: string[];
  synthesizer?: string;
}) => Promise<{
  agentResults: Array<{ agent: string; sessionId: string; content: string }>;
  synthesis: string;
}>;

export type SkillManageFn = (input: {
  action: 'promote' | 'list_drafts';
  slug?: string;
}) => Promise<unknown>;

export async function delegateTaskTool(
  fn: DelegateTaskFn | undefined,
  input: { agent: string; task: string; context?: string },
): Promise<{ sessionId: string; content: string; status: string }> {
  if (!fn) throw new Error('delegateTask handler not configured');
  return fn(input);
}

export async function cronjobTool(
  fn: CronjobFn | undefined,
  input: {
    action: 'list' | 'run' | 'create';
    slug?: string;
    schedule?: string;
    agent?: string;
    prompt?: string;
    timezone?: string;
  },
): Promise<unknown> {
  if (!fn) throw new Error('manageCronjob handler not configured');
  return fn(input);
}

export async function skillsListTool(fn: ListSkillsFn | undefined): Promise<{ skills: string[] }> {
  if (!fn) throw new Error('listSkills handler not configured');
  const skills = await fn();
  return { skills };
}

export async function skillViewTool(
  fn: GetSkillFn | undefined,
  slug: string,
): Promise<{ skill: Awaited<ReturnType<GetSkillFn>> }> {
  if (!fn) throw new Error('getSkill handler not configured');
  const skill = await fn(slug);
  return { skill };
}

export async function sendMessageTool(
  fn: SendMessageFn | undefined,
  input: { message: string; channel?: string; sessionId?: string },
): Promise<{ ok: boolean }> {
  if (!fn) throw new Error('sendMessage handler not configured');
  return fn(input);
}

export async function mixtureOfAgentsTool(
  fn: MixtureOfAgentsFn | undefined,
  input: { task: string; agents: string[]; synthesizer?: string },
): Promise<Awaited<ReturnType<MixtureOfAgentsFn>>> {
  if (!fn) throw new Error('mixtureOfAgents handler not configured');
  return fn(input);
}

export async function skillManageTool(
  fn: SkillManageFn | undefined,
  input: { action: 'promote' | 'list_drafts'; slug?: string },
): Promise<unknown> {
  if (!fn) throw new Error('skillManage handler not configured');
  return fn(input);
}
