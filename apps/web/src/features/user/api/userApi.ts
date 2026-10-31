import {
  DEFAULT_USER,
  type UserIdentity,
  type UserPermissions,
} from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

export const NO_PERMISSIONS: UserPermissions = {
  isAdmin: false,
  canEditBundles: false,
};

/**
 * Fetches the current user from `GET /api/me`. The endpoint returns `401`/`501`
 * when no Oktasso JWT is present (e.g. local development), so any non-ok
 * response resolves to {@link DEFAULT_USER} rather than throwing — the UI always
 * has an identity to render.
 */
export async function getMe(): Promise<UserIdentity> {
  try {
    const res = await apiFetch("/api/me");
    if (!res.ok) return DEFAULT_USER;
    return (await res.json()) as UserIdentity;
  } catch {
    return DEFAULT_USER;
  }
}

function isUserPermissions(value: unknown): value is UserPermissions {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.isAdmin === "boolean" &&
    typeof record.canEditBundles === "boolean"
  );
}

/** Fetches what the current user may manage from `GET /api/me/permissions`. */
export async function getMyPermissions(): Promise<UserPermissions> {
  const res = await apiFetch("/api/me/permissions");
  if (!res.ok) return NO_PERMISSIONS;
  const body = (await res.json().catch(() => undefined)) as unknown;
  return isUserPermissions(body) ? body : NO_PERMISSIONS;
}
