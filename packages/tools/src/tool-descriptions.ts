const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  web_fetch: 'Fetch URL content as text. Args: { "url": string }',
  web_search: 'Search the web. Args: { "query": string }',
  execute_code: 'Run code in sandbox. Args: { "code": string, "language"?: string }',
  glob_files: 'Glob files under workspace. Args: { "pattern": string, "maxResults"?: number }',
  grep_search: 'Search file contents under workspace. Args: { "pattern": string, "path"?: string, "maxResults"?: number }',
  execute_code_pipeline: 'Run multi-step code in sandbox. Args: { "steps": [{ "code": string, "language"?: string }] }',
  file_read: 'Read file under workspace. Args: { "path": string }',
  file_write: 'Write file under workspace. Args: { "path": string, "content": string }',
  browser: 'Browser automation. Args: { "url": string, "action"?: "navigate"|"screenshot"|"content", "selector"?: string }',
  image_generate: 'Generate image via DALL-E. Args: { "prompt": string, "size"?: "1024x1024" }',
  text_to_speech: 'Synthesize speech (OpenAI TTS). Args: { "text": string }',
  memory_recall: 'Recall long-term memory entries. Args: { "query": string, "userId"?: string, "limit"?: number }',
  list_dir: 'List directory entries under workspace. Args: { "path"?: string }',
  edit_file: 'Replace text in a workspace file. Args: { "path": string, "old_string": string, "new_string": string, "replace_all"?: boolean }',
  run_shell: 'Run shell command via sandbox executor. Args: { "command": string }',
  http_request: 'HTTP request with method/headers/body. Args: { "url": string, "method"?: string, "headers"?: object, "body"?: string }',
  path_exists: 'Check if path exists in workspace. Args: { "path": string }',
  file_delete: 'Delete a file under workspace. Args: { "path": string }',
  append_file: 'Append text to a workspace file. Args: { "path": string, "content": string }',
  json_parse: 'Parse JSON text. Args: { "text": string }',
  datetime_now: 'Current datetime (ISO + unix). Args: { "timezone"?: string }',
};

export function describeBuiltinTool(toolName: string): string {
  const key = toolName.replace(/^anvio_tools__/, '');
  return DEFAULT_DESCRIPTIONS[key] ?? `Builtin tool ${toolName}`;
}

export function renderToolInstructions(toolNames: string[]): string {
  if (toolNames.length === 0) return '';

  const lines = toolNames.map((name) => `- ${name}: ${describeBuiltinTool(name)}`);
  return [
    '## Available tools',
    'When you need a tool, emit a fenced block exactly like:',
    '```anvio_tool',
    '{"name": "anvio_tools__web_fetch", "arguments": {"url": "https://example.com"}}',
    '```',
    'Wait for the tool result before continuing. Do not invent tool output.',
    '',
    ...lines,
  ].join('\n');
}
