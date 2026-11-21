import { IdentityFreshness } from "@tangent/shared/identityRefresh";

import { apiFetch } from "@/shared/lib/apiFetch";

export const identityFreshness = new IdentityFreshness();

/**
 * Makes one cheap request when the last one is old, so the proxy restamps the
 * caller's identity before the message that follows. Failures are ignored: the
 * message is sent either way.
 */
export async function refreshIdentityIfStale(): Promise<void> {
  if (!identityFreshness.isStale()) return;
  try {
    await apiFetch("/api/me");
  } catch {
    // A failed probe must not block the message; the server decides what to do
    // with a stale identity.
  }
}
