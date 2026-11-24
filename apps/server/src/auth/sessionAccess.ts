import type { Session } from "@tangent/shared/contracts.ts";

/** True when `email` holds a Membership in `sessionId` — the gate chat uses. */
export type SessionMemberCheck = (
  sessionId: string,
  email: string,
) => Promise<boolean>;

/** True when `email` owns `session`: its creator, or any human when auth is off. */
export function isSessionOwner(session: Session, email: string): boolean {
  const owner = session.user?.email;
  if (!owner) return true;
  return owner === email;
}

/**
 * Whether `email` may read `session`: anyone on an `open` session, else its
 * owner or a Membership holder. The same rule the chat join applies when it
 * decides which Conversations a socket receives.
 */
export async function mayReadSession(
  session: Session,
  email: string,
  isSessionMember: SessionMemberCheck,
): Promise<boolean> {
  if (session.accessPolicy === "open") return true;
  if (isSessionOwner(session, email)) return true;
  return isSessionMember(session.id, email);
}
