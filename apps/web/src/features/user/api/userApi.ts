import type { UserIdentity } from "@tangent/shared/contracts";

import { apiUrl } from "@/shared/lib/basePath";

import { DEFAULT_USER } from "../model/userDisplay";

/**
 * Fetches the current user from `GET /api/me`. The endpoint returns `401`/`501`
 * when no Minerva JWT is present (e.g. local development), so any non-ok
 * response resolves to {@link DEFAULT_USER} rather than throwing — the UI always
 * has an identity to render.
 */
export async function getMe(): Promise<UserIdentity> {
  try {
    const res = await fetch(apiUrl("/api/me"));
    if (!res.ok) return DEFAULT_USER;
    return (await res.json()) as UserIdentity;
  } catch {
    return DEFAULT_USER;
  }
}
