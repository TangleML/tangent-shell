import type {
  RunIngress,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";
import { asc, eq } from "drizzle-orm";

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

  async put(membership: Membership): Promise<void> {
    const { reaction, ingress, transcriptVisibility } = membership;
    this.db
      .insert(memberships)
      .values({
        participantId: membership.participantId,
        conversationId: membership.conversationId,
        sessionId: membership.sessionId,
        reaction,
        ingress,
        transcriptVisibility,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          memberships.sessionId,
          memberships.conversationId,
          memberships.participantId,
        ],
        set: { reaction, ingress, transcriptVisibility },
      })
      .run();
  }
}
