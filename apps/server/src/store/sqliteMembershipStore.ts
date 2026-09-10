import type {
  AdmissionPolicy,
  RunIngress,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { type MembershipRow, memberships } from "./db/schema.ts";
import type { Membership, MembershipStore } from "./membershipStore.ts";

/** Maps a memberships row onto the domain {@link Membership}. */
function toMembership(row: MembershipRow): Membership {
  return {
    sessionId: row.sessionId,
    participantId: row.participantId,
    conversationId: row.conversationId,
    reaction: row.reaction,
    ingress: row.ingress as RunIngress,
    admission: row.admission as AdmissionPolicy,
    transcriptVisibility: row.transcriptVisibility as TranscriptVisibility,
  };
}

/** SQLite-backed {@link MembershipStore} over the shared session metadata DB. */
export class SqliteMembershipStore implements MembershipStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async listForSession(sessionId: string): Promise<Membership[]> {
    const rows = this.db
      .select()
      .from(memberships)
      .where(eq(memberships.sessionId, sessionId))
      .orderBy(asc(memberships.createdAt))
      .all();
    return rows.map(toMembership);
  }

  async listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Membership[]> {
    const rows = this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.sessionId, sessionId),
          eq(memberships.conversationId, conversationId),
        ),
      )
      .orderBy(asc(memberships.createdAt))
      .all();
    return rows.map(toMembership);
  }

  async get(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<Membership | undefined> {
    const row = this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.sessionId, sessionId),
          eq(memberships.conversationId, conversationId),
          eq(memberships.participantId, participantId),
        ),
      )
      .get();
    return row ? toMembership(row) : undefined;
  }

  async put(membership: Membership): Promise<void> {
    const { reaction, ingress, admission, transcriptVisibility } = membership;
    this.db
      .insert(memberships)
      .values({
        participantId: membership.participantId,
        conversationId: membership.conversationId,
        sessionId: membership.sessionId,
        reaction,
        ingress,
        admission,
        transcriptVisibility,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          memberships.sessionId,
          memberships.conversationId,
          memberships.participantId,
        ],
        set: { reaction, ingress, admission, transcriptVisibility },
      })
      .run();
  }

  async remove(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<void> {
    this.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.sessionId, sessionId),
          eq(memberships.conversationId, conversationId),
          eq(memberships.participantId, participantId),
        ),
      )
      .run();
  }
}
