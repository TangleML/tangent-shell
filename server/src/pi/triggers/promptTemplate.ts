/**
 * Default prompt rendering for triggers without an embedded handler.
 *
 * A trigger's `prompt` may embed `{{dotted.path}}` placeholders that are
 * substituted with values from the signal payload (the schedule context or the
 * callback's JSON body). Missing paths render as the empty string; non-string
 * values are JSON-encoded so structured payloads remain legible in the prompt.
 */

/** Resolves a dotted path (`a.b.c`) against the signal, or `undefined`. */
function lookup(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const key of dotted.split(".")) {
    if (
      current &&
      typeof current === "object" &&
      key in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[key];
      continue;
    }
    return undefined;
  }
  return current;
}

/** Interpolates `{{path}}` placeholders in `template` from `signal`. */
export function renderPrompt(template: string, signal: unknown): string {
  return template.replace(
    /\{\{\s*([\w.$-]+)\s*\}\}/g,
    (_match, expr: string) => {
      const value = lookup(signal, expr);
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  );
}
