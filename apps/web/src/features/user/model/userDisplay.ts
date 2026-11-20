import type { UserIdentity, UserPermissions } from "@tangent/shared/contracts";

export function userInitials(name: string): string {
  const display = name.includes("@")
    ? name.split("@")[0].replace(/[._-]+/g, " ")
    : name;
  const words = display.trim().split(/\s+/);
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase() || "?";
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
