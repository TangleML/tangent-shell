import type { UserIdentity } from "@tangent/shared/contracts";

/**
 * The user's initials for an avatar badge: first letter of the first name plus
 * first letter of the last name, uppercased (e.g. `John Smith` -> `JS`).
 * Resilient to missing name parts; falls back to `?` when both are empty.
 */
export function userInitials(user: UserIdentity): string {
  const first = user.first_name.trim().charAt(0);
  const last = user.last_name.trim().charAt(0);
  const initials = `${first}${last}`.toUpperCase();
  return initials || "?";
}
