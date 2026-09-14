/**
 * Boundary-aware message splitter shared by every adapter with a per-message
 * length limit.
 *
 * The implementation it replaces — copy-pasted verbatim into telegram,
 * discord and whatsapp, and missing entirely from slack and mattermost —
 * sliced at a raw offset (issue #72). That cut surrogate pairs in half and
 * left Markdown entities unbalanced across the seam, which Telegram rejects
 * with `400 can't parse entities`; since nothing caught that, the whole reply
 * was lost. Long agent answers are mostly code, so a fence opened in one
 * chunk and closed in the next was the common case, not the rare one.
 *
 * Splitting prefers structure over arithmetic: line, then word, and only then
 * a hard cut — which is still taken on a code-point boundary. A code fence
 * left open at the end of a chunk is closed there and reopened, with its
 * language, at the start of the next.
 */

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const ANY_FENCE = /^\s*(`{3,}|~{3,})/m;

/** Headroom kept back for a fence that has to be closed and reopened. */
const FENCE_RESERVE = 16;

interface FenceState {
  marker: string;
  info: string;
}

/**
 * A unit is one line, or one slice of a line too long to fit. `separator` is
 * what rejoins it to the preceding unit — a newline for a genuine line break,
 * empty for the continuation of a line we had to break ourselves, so the
 * split does not invent line breaks that were not in the source.
 */
interface Unit {
  text: string;
  separator: '' | '\n';
}

/**
 * Fence transition for `line`, given the currently open fence: a new
 * `FenceState` when one opens, `null` when one closes, `undefined` when the
 * line is ordinary text.
 */
function fenceTransition(line: string, open: FenceState | null): FenceState | null | undefined {
  const match = FENCE.exec(line);
  if (!match) return undefined;
  const marker = match[1]!;
  const info = match[2]!.trim();
  if (!open) return { marker, info };
  // A closing fence uses the same character, is at least as long, and carries
  // no info string. Anything else is just text inside the block.
  return marker[0] === open.marker[0] && marker.length >= open.marker.length && !info
    ? null
    : undefined;
}

/**
 * Largest cut at or below `limit` that does not land between a surrogate
 * pair. `slice` works on UTF-16 code units, so cutting there would leave a
 * lone surrogate rendering as a replacement character on both sides.
 */
function safeCut(text: string, limit: number): number {
  if (limit >= text.length) return text.length;
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/** Break one over-long line, preferring a word boundary near the limit. */
function splitLine(line: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    let cut = safeCut(rest, limit);
    // Never stall: safeCut can only step back one unit, and limit >= 1.
    if (cut <= 0) cut = 1;
    const space = rest.lastIndexOf(' ', cut);
    // Honour a word boundary only when it does not waste most of the chunk.
    if (space > limit * 0.6) cut = space;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

export function splitMessage(text: string, maxLen: number): string[] {
  if (maxLen <= 0 || text.length <= maxLen) return [text];

  // Only pay for fence headroom when the text actually has fences, and never
  // let the reserve eat the budget on a small limit.
  const reserve = ANY_FENCE.test(text) ? Math.min(FENCE_RESERVE, Math.floor(maxLen / 4)) : 0;
  const unitLimit = Math.max(1, maxLen - reserve);

  // Pre-split over-long lines so the assembly loop only handles units that fit.
  const units: Unit[] = [];
  for (const line of text.split('\n')) {
    const separator: '\n' | '' = units.length === 0 ? '' : '\n';
    if (line.length <= unitLimit) {
      units.push({ text: line, separator });
      continue;
    }
    const parts = splitLine(line, unitLimit);
    parts.forEach((part, index) => {
      units.push({ text: part, separator: index === 0 ? separator : '' });
    });
  }

  const chunks: string[] = [];
  let current = '';
  let fence: FenceState | null = null;

  const capacity = () => (fence ? maxLen - reserve : maxLen);

  const flush = () => {
    if (!current) return;
    chunks.push(fence ? `${current}\n${fence.marker}` : current);
    // The block continues in the next chunk, so reopen it there.
    current = fence ? `${fence.marker}${fence.info}` : '';
  };

  /**
   * A continuation normally joins with nothing, so a line we broke ourselves
   * is rebuilt exactly. The exception is straight after a reopened fence,
   * where concatenating would corrupt the fence line itself; there the
   * newline is the lesser evil, and inside a code block it is invisible.
   */
  const separatorFor = (unit: Unit): string => {
    if (!current) return '';
    if (unit.separator !== '') return unit.separator;
    return fence && current === `${fence.marker}${fence.info}` ? '\n' : '';
  };

  for (const unit of units) {
    if (current && current.length + separatorFor(unit).length + unit.text.length > capacity()) {
      flush();
    }
    current = `${current}${separatorFor(unit)}${unit.text}`;

    const transition = fenceTransition(unit.text, fence);
    if (transition !== undefined) fence = transition;
  }

  // The final chunk keeps whatever balance the original text had — closing a
  // fence the author left open would change the content, not preserve it.
  if (current) chunks.push(current);

  return chunks.filter((chunk) => chunk.length > 0);
}
