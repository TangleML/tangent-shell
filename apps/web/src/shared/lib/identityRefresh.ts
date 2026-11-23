import { IdentityFreshness } from "@tangent/shared/identityRefresh";

import { apiFetch } from "@/shared/lib/apiFetch";

export const identityFreshness = new IdentityFreshness();

let pendingRefresh: Promise<void> | undefined;

const ignore = (): void => undefined;

/**
 * Makes one cheap request when the last one is old, so the proxy restamps the
 * caller's identity before the message that follows. Callers that arrive while
 * a probe is in flight share it, so their work settles in call order. Failures
 * are ignored: the message is sent either way.
 */
export function refreshIdentityIfStale(): Promise<void> {
  if (!identityFreshness.isStale()) return Promise.resolve();
  pendingRefresh ??= apiFetch("/api/me")
    .then(ignore, ignore)
    .finally(() => {
      pendingRefresh = undefined;
    });
  return pendingRefresh;
}
