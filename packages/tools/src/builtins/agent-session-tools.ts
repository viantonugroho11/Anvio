export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const todoStore = new Map<string, TodoItem[]>();

export function todoTool(
  sessionId: string,
  input: { todos?: Array<{ id?: string; content: string; status?: TodoItem['status'] }>; merge?: boolean },
): { todos: TodoItem[] } {
  const key = sessionId || 'default';
  let items = todoStore.get(key) ?? [];
  if (input.todos?.length) {
    if (input.merge) {
      for (const t of input.todos) {
        const id = t.id ?? `todo-${items.length + 1}`;
        const existing = items.find((i) => i.id === id);
        if (existing) {
          existing.content = t.content;
          if (t.status) existing.status = t.status;
        } else {
          items.push({ id, content: t.content, status: t.status ?? 'pending' });
        }
      }
    } else {
      items = input.todos.map((t, i) => ({
        id: t.id ?? `todo-${i + 1}`,
        content: t.content,
        status: t.status ?? 'pending',
      }));
    }
    todoStore.set(key, items);
  }
  return { todos: items };
}

export function clarifyTool(input: {
  question: string;
  choices?: string[];
  mode?: 'choice' | 'freeform';
}): { question: string; choices: string[]; mode: string; instruction: string } {
  const choices = input.choices?.slice(0, 4) ?? [];
  return {
    question: input.question,
    choices,
    mode: input.mode ?? (choices.length ? 'choice' : 'freeform'),
    instruction: 'Wait for the user to answer before proceeding with irreversible actions.',
  };
}

export type SessionSearchFn = (
  query: string,
  limit?: number,
) => Promise<Array<{ sessionId: string; agentName: string; channel: string; snippet: string }>>;

export async function sessionSearchTool(
  searchFn: SessionSearchFn | undefined,
  query: string,
  limit = 10,
): Promise<{
  query: string;
  results: Array<{ sessionId: string; agentName: string; channel: string; snippet: string }>;
  note?: string;
}> {
  if (!searchFn) {
    return { query, results: [], note: 'session search not configured' };
  }
  const results = await searchFn(query, limit);
  return { query, results };
}
