import { DEFAULT_MODEL_ID, type PublicConfig } from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

const FALLBACK_CONFIG: PublicConfig = {
  shellUrl: "",
  defaultModel: DEFAULT_MODEL_ID,
};

/**
 * Fetches the public client config from `GET /api/config`. Any non-ok response
 * or network error resolves to an empty `shellUrl` so callers fall back to their
 * own origin rather than throwing.
 */
export async function getPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) return FALLBACK_CONFIG;
    return (await res.json()) as PublicConfig;
  } catch {
    return FALLBACK_CONFIG;
  }
}
