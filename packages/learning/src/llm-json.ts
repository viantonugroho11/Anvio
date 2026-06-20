/** Extract JSON object from LLM text (handles optional markdown fences). */
export function parseLlmJson<T>(content: string): T | undefined {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function isUsableModelProvider(provider: { providerId: string } | undefined): boolean {
  return provider != null && provider.providerId !== 'mock';
}
