import type { PublicConfig } from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

/**
 * Fetches the public client config from `GET /api/config`. Any non-ok response
 * or network error resolves to an empty `shellUrl` so callers fall back to their
 * own origin rather than throwing.
 */
export async function getPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) return { shellUrl: "" };
    return (await res.json()) as PublicConfig;
  } catch {
    return { shellUrl: "" };
  }
}
