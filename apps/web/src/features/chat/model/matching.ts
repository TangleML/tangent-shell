/** Matches the server's mention normalization (drop case, spaces, `_`, `-`). */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

/** What {@link matchRank} gives a label that doesn't contain the query. */
export const NO_MATCH = 4;

/**
 * How closely a label matches what was typed, closest first, so pickers put an
 * exact name ahead of names that merely contain it: 0 the whole label, 1 its
 * start, 2 the start of a word in it, 3 anywhere in it, else {@link NO_MATCH}.
 */
export function matchRank(label: string, query: string): number {
  const name = normalize(label);
  const typed = normalize(query);
  if (name === typed) return 0;
  if (name.startsWith(typed)) return 1;
  const lowered = query.trim().toLowerCase();
  const words = label.toLowerCase().split(/[\s_\-/.]+/);
  if (words.some((word) => word.startsWith(lowered))) return 2;
  return name.includes(typed) ? 3 : NO_MATCH;
}
