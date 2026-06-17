import type { UserIdentity } from "@tangent/shared/contracts";

/**
 * Safety-net identity used when the Minerva JWT is unavailable (e.g. local
 * development without the cookie configured), so the UI always has a name to
 * show.
 */
export const DEFAULT_USER: UserIdentity = {
  email: "",
  first_name: "John",
  last_name: "Smith",
};

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

/**
 * The user's short display name: first name plus last-name initial (e.g.
 * `John Smith` -> `John S.`). Falls back to the first name alone, then the
 * email, when name parts are missing.
 */
export function userShortName(user: UserIdentity): string {
  const first = user.first_name.trim();
  const lastInitial = user.last_name.trim().charAt(0).toUpperCase();
  if (first && lastInitial) return `${first} ${lastInitial}.`;
  return first || user.email;
}
