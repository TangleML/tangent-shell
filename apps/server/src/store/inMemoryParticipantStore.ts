import type { Presence } from "@tangent/shared/contracts.ts";

import type { Participant, ParticipantStore } from "./participantStore.ts";

/** Key of one participant, matching the table's uniqueness. */
function keyFor(sessionId: string, id: string): string {
  return `${sessionId}\u0000${id}`;
}

/**
 * Process-local {@link ParticipantStore}, mirroring
 * {@link import("./inMemoryMembershipStore.ts").InMemoryMembershipStore}. For
 * tests and for wiring a participant registry that has no DB to write to.
 */
export class InMemoryParticipantStore implements ParticipantStore {
  private readonly participants = new Map<string, Participant>();

  async listForSession(sessionId: string): Promise<Participant[]> {
    return [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(sessionId: string, id: string): Promise<Participant | undefined> {
    return this.participants.get(keyFor(sessionId, id));
  }

  async put(participant: Participant): Promise<void> {
    this.participants.set(
      keyFor(participant.sessionId, participant.id),
      participant,
    );
  }

  async updatePresence(
    sessionId: string,
    id: string,
    presence: Presence,
  ): Promise<void> {
    const existing = this.participants.get(keyFor(sessionId, id));
    if (!existing) return;
    this.participants.set(keyFor(sessionId, id), { ...existing, presence });
  }

  async revoke(sessionId: string, id: string): Promise<void> {
    const existing = this.participants.get(keyFor(sessionId, id));
    if (!existing) return;
    this.participants.set(keyFor(sessionId, id), {
      ...existing,
      capabilities: [],
      revokedAt: new Date().toISOString(),
    });
  }

  async deleteForSession(sessionId: string): Promise<void> {
    for (const [key, participant] of this.participants) {
      if (participant.sessionId === sessionId) this.participants.delete(key);
    }
  }
}
