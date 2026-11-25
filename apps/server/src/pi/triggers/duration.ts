/** Milliseconds per duration unit accepted by {@link parseDuration}. */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a short duration (`"45s"`, `"30m"`, `"1h"`, `"2d"`) into ms, or
 * `undefined` when absent or malformed. Shared by schedule intervals and
 * trigger lifetimes (`expiresIn`).
 */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * UNIT_MS[match[2]];
}
