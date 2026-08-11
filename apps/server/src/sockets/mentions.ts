/**
 * Resolving `@name` in a message body to participant ids, once, at write time.
 *
 * The point is that nothing downstream re-reads the body to decide who should
 * act: `ChatMessage.mentions` carries ids, and a participant renamed later does
 * not change who an old message addressed.
 */

/** A participant a mention can resolve to. */
export interface MentionCandidate {
  id: string;
  name: string;
}

/** `@` followed by a run of non-whitespace, which is the whole mention grammar. */
const MENTION_PATTERN = /@([^\s@]+)/g;

/**
 * Strips the characters a display name carries but a typed mention won't, so
 * `@WorkerOne` matches a participant named `Worker One`.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * Trailing punctuation belongs to the sentence, not the name: `@prime,` and
 * `@prime.` both address Prime.
 */
function trimTrailingPunctuation(token: string): string {
  return token.replace(/[.,;:!?)\]}'"]+$/, "");
}

/**
 * Resolves every `@name` in `text` to a candidate's id, in first-mention order
 * and without duplicates. A mention matching nothing in the roster is left as
 * prose — an unresolvable id would be worse than no mention at all.
 *
 * Names are matched case-insensitively and ignoring spaces, underscores and
 * hyphens, so a multiword name is reachable only when typed without its spaces.
 * Ids match too, which is how a client that already knows an id can be exact.
 */
export function resolveMentions(
  text: string,
  candidates: readonly MentionCandidate[],
): string[] {
  const byToken = new Map<string, string>();
  for (const candidate of candidates) {
    byToken.set(normalize(candidate.name), candidate.id);
    byToken.set(normalize(candidate.id), candidate.id);
  }

  const resolved: string[] = [];
  for (const [, token] of text.matchAll(MENTION_PATTERN)) {
    const id = byToken.get(normalize(trimTrailingPunctuation(token)));
    if (id && !resolved.includes(id)) resolved.push(id);
  }
  return resolved;
}
