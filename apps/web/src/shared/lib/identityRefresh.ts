import { IdentityFreshness } from "@tangent/shared/identityRefresh";

import { apiFetch } from "@/shared/lib/apiFetch";

export const identityFreshness = new IdentityFreshness();

let pendingRefresh: Promise<void> | undefined;

const ignore = (): void => undefined;

/** The session read is the one probe the server records a bearer from. */
function probePath(sessionId: string | undefined): string {
  return sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}`
    : "/api/me";
}

/**
 * Makes one cheap request when the last one is old, so the caller's identity
 * is fresh before the message that follows: a front proxy restamps it on any
 * request, while an embed host's own token is only recorded by the server once
 * a session has admitted it, so the probe reads the session when one is known.
 * Callers that arrive while a probe is in flight share it, whether or not the
 * identity still reads as stale, so their work settles in call order and none
 * overtakes a message parked behind the probe. Failures are ignored: the
 * message is sent either way.
 */
export function refreshIdentityIfStale(sessionId?: string): Promise<void> {
  if (pendingRefresh) return pendingRefresh;
  if (!identityFreshness.isStale()) return Promise.resolve();
  pendingRefresh = apiFetch(probePath(sessionId))
    .then(ignore, ignore)
    .finally(() => {
      pendingRefresh = undefined;
    });
  return pendingRefresh;
}
