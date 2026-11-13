import type {
  BundleExtensionPolicy,
  ExtensionSelection,
} from "@tangent/shared/contracts.ts";

/** Whether a bundle policy is the locked `{ only }` form. */
export function isLockedPolicy(
  policy: BundleExtensionPolicy | undefined,
): policy is { only: string[] } {
  return (
    typeof policy === "object" && !Array.isArray(policy) && "only" in policy
  );
}

/** Dedupes while preserving first-seen order. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Resolves the effective global-extension set for a spawn from the two opt-in
 * layers: a bundle's {@link BundleExtensionPolicy} and a session's
 * {@link ExtensionSelection}. Returns `"all"` (every installed extension) or an
 * explicit, deduped list of ids. Pure, so the rules are unit-testable in one
 * place; the caller expands `"all"` to the currently installed ids.
 *
 * Precedence (see the `BundleExtensionPolicy` / `ExtensionSelection` contracts):
 * - `{ only }`: always exactly those ids, whatever the session asks (the API
 *   rejects a defined session selection against a locked bundle).
 * - No bundle policy: the session's own value (absent means none).
 * - Bundle `"all"`: the session overrides fully; absent inherits all.
 * - Bundle list: a session list extends it, `"none"` clears it, `"all"` widens
 *   to all, and absent inherits the bundle ids.
 */
export function resolveExtensionSelection(
  policy: BundleExtensionPolicy | undefined,
  selection: ExtensionSelection | undefined,
): "all" | string[] {
  if (isLockedPolicy(policy)) return unique(policy.only);
  if (selection === "all") return "all";
  if (selection === "none") return [];
  return resolveListSelection(policy, selection);
}

/**
 * The non-locked path, where the session selection is a list or absent: no
 * bundle policy means the session's own value (absent = none); bundle `"all"`
 * is overridden by any list and inherited when absent; a bundle list is
 * extended by a session list and inherited when absent.
 */
function resolveListSelection(
  policy: "all" | string[] | undefined,
  selection: string[] | undefined,
): "all" | string[] {
  if (policy === undefined) {
    return selection === undefined ? [] : unique(selection);
  }
  if (policy === "all") {
    return selection === undefined ? "all" : unique(selection);
  }
  return selection === undefined
    ? unique(policy)
    : unique([...policy, ...selection]);
}
