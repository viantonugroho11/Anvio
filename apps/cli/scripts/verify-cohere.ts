/**
 * One real call to Cohere's OpenAI compatibility endpoint, through the adapter
 * that would serve it in production (issue #24).
 *
 * ADR-0015 D5 pointed `cohere` at `https://api.cohere.ai/compatibility/v1` as a
 * hypothesis. Cohere's own documentation later confirmed the endpoint and the
 * model id, but documentation cannot prove that the *response* parses cleanly
 * through `OpenAICompatibleProvider` — the one thing the issue actually asks for.
 * This script supplies that receipt.
 *
 *     COHERE_API_KEY=... pnpm --filter @anvio/cli exec tsx scripts/verify-cohere.ts
 *
 * The key is read from the environment and never printed. Output is a verdict
 * and the parsed field values, so it is safe to paste into the issue.
 */
import { createModelProvider } from '@anvio/models';

const apiKey = process.env.COHERE_API_KEY;
if (!apiKey) {
  console.error(
    'COHERE_API_KEY is not set. Run:\n\n  COHERE_API_KEY=... pnpm --filter @anvio/cli exec tsx scripts/verify-cohere.ts\n',
  );
  process.exit(2);
}

const provider = createModelProvider({ provider: 'cohere', apiKey });

function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
  return ok;
}

async function main(): Promise<void> {
  console.log(
    `\nProvider: cohere · model: ${(provider as unknown as { defaultModel: string }).defaultModel}\n`,
  );

  const response = await provider.chat({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    maxTokens: 16,
  });

  const results = [
    check(
      'content parsed',
      typeof response.content === 'string' && response.content.length > 0,
      JSON.stringify(response.content),
    ),
    check(
      'model echoed',
      typeof response.model === 'string' && response.model.length > 0,
      String(response.model),
    ),
    // The field most likely to differ: `finish_reason` is where an
    // OpenAI-compatible endpoint tends to invent its own vocabulary.
    check('finishReason present', response.finishReason != null, String(response.finishReason)),
    check(
      'usage.inputTokens is a number',
      Number.isFinite(response.usage?.inputTokens),
      String(response.usage?.inputTokens),
    ),
    check(
      'usage.outputTokens is a number',
      Number.isFinite(response.usage?.outputTokens),
      String(response.usage?.outputTokens),
    ),
    check(
      'usage.totalTokens is a number',
      Number.isFinite(response.usage?.totalTokens),
      String(response.usage?.totalTokens),
    ),
  ];

  const failed = results.filter((ok) => !ok).length;
  console.log(
    failed === 0
      ? '\nAll fields parsed. #24 can be closed on this output.\n'
      : `\n${failed} field(s) did not parse — the compatibility endpoint diverges from the OpenAI shape.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  // A 401 means the key is wrong, not that the endpoint is. Anything else is the
  // finding: an unexpected status, a path Cohere does not serve, or a body that
  // could not be read.
  console.error('\nCall failed:', error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.cause) console.error('cause:', error.cause);
  process.exit(1);
});
