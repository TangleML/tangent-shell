import type { Membership, MembershipStore } from "./membershipStore.ts";

/** Key of one membership, matching the table's uniqueness. */
function keyFor(membership: Membership): string {
  const { sessionId, conversationId, participantId } = membership;
  return `${sessionId}\u0000${conversationId}\u0000${participantId}`;
}

/**
 * Process-local {@link MembershipStore}, mirroring
 * {@link import("./inMemoryRunStore.ts").InMemoryRunStore}. For tests and for
 * wiring a membership registry that has no DB to write to.
 */
export class InMemoryMembershipStore implements MembershipStore {
  private readonly memberships = new Map<string, Membership>();

  async listForSession(sessionId: string): Promise<Membership[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.sessionId === sessionId,
    );
  }

  async put(membership: Membership): Promise<void> {
    this.memberships.set(keyFor(membership), membership);
  }
}
