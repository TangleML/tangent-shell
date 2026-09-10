import type { ReactorRecord } from "@tangent/shared/contracts.ts";

import type { ReactorStore } from "./reactorStore.ts";

/**
 * Process-local {@link ReactorStore}, mirroring
 * {@link import("./inMemoryMembershipStore.ts").InMemoryMembershipStore}. For
 * tests and for wiring a reactor registry that has no DB to write to.
 */
export class InMemoryReactorStore implements ReactorStore {
  private readonly reactors = new Map<string, ReactorRecord>();

  async put(record: ReactorRecord): Promise<void> {
    this.reactors.set(record.id, record);
  }

  async get(id: string): Promise<ReactorRecord | undefined> {
    return this.reactors.get(id);
  }

  async listForSession(sessionId: string): Promise<ReactorRecord[]> {
    return [...this.reactors.values()].filter(
      (record) => record.sessionId === sessionId,
    );
  }

  async listForParticipant(
    sessionId: string,
    participantId: string,
  ): Promise<ReactorRecord[]> {
    return [...this.reactors.values()].filter(
      (record) =>
        record.sessionId === sessionId &&
        record.participantId === participantId,
    );
  }

  async listObserving(
    sessionId: string,
    conversationId: string,
  ): Promise<ReactorRecord[]> {
    return [...this.reactors.values()].filter(
      (record) =>
        record.sessionId === sessionId &&
        record.scope.memberships.some(
          (member) => member.conversationId === conversationId,
        ),
    );
  }

  async remove(id: string): Promise<void> {
    this.reactors.delete(id);
  }
}
