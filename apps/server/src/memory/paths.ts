import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * `p` with every symlink in its longest existing prefix resolved, so a store
 * that doesn't exist yet still canonicalizes the same way it will once created.
 */
export function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  const tail: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      return path.join(realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** True when `child` lies strictly below `parent` (both absolute). */
export function isStrictlyInside(child: string, parent: string): boolean {
  return child.startsWith(parent + path.sep);
}

function overlaps(a: string, b: string): boolean {
  return a === b || isStrictlyInside(a, b) || isStrictlyInside(b, a);
}

/** The names of the first two `roots` that are the same directory or nested. */
export function nestedRoots(
  roots: Record<string, string>,
): [string, string] | undefined {
  const entries = Object.entries(roots).map(
    ([name, root]) => [name, canonicalPath(root)] as const,
  );
  const pairs = entries.flatMap((a, i) =>
    entries.slice(i + 1).map((b) => [a, b] as const),
  );
  const clash = pairs.find(([[, a], [, b]]) => overlaps(a, b));
  return clash && [clash[0][0], clash[1][0]];
}
