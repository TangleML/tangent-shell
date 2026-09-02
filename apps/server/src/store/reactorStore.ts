import type { ReactorRecord } from "@tangent/shared/contracts.ts";

/**
 * Durable home of a session's installed {@link ReactorRecord}s. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason
 * {@link import("./runStore.ts").RunStore} and
 * {@link import("./membershipStore.ts").MembershipStore} are: it is read by the
 * reactor registry on the delivery path, not by the REST routes.
 */
export interface ReactorStore {
  /** Upserts by `(sessionId, participantId, scopeKey)`, so reinstalling a scope
   * replaces its row rather than stacking a duplicate join. */
  put(record: ReactorRecord): Promise<void>;
  /** One reactor, or nothing when the id is unknown. */
  get(id: string): Promise<ReactorRecord | undefined>;
  /** Every reactor installed in a session. */
  listForSession(sessionId: string): Promise<ReactorRecord[]>;
  /** Every reactor a participant installed in a session. */
  listForParticipant(
    sessionId: string,
    participantId: string,
  ): Promise<ReactorRecord[]>;
  /** Every reactor whose scope observes the given Conversation. */
  listObserving(
    sessionId: string,
    conversationId: string,
  ): Promise<ReactorRecord[]>;
  /** Removes one reactor. A no-op when there is none to remove. */
  remove(id: string): Promise<void>;
}

/** The scope digest that keys a reactor's row, deterministic across installs. */
export function scopeKeyFor(record: {
  homeConversationId: string;
  scope: ReactorRecord["scope"];
}): string {
  const memberships = record.scope.memberships
    .map((member) => `${member.conversationId}:${member.participantId}`)
    .sort()
    .join(",");
  return `${record.homeConversationId}\u0000${memberships}`;
}
