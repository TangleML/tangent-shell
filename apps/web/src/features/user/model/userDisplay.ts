import type { UserIdentity, UserPermissions } from "@tangent/shared/contracts";

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

/** The user's full name, falling back to their email when both names are empty. */
export function userFullName(user: UserIdentity): string {
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return fullName || user.email;
}

/** A human-readable label for what the user may do. */
export function userRoleLabel(permissions: UserPermissions): string {
  if (permissions.isAdmin) return "Admin";
  if (permissions.canEditBundles) return "Bundle editor";
  return "Member";
}
