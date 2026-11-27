import { and, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { triggerDelegations } from "./db/schema.ts";
import type {
  TriggerDelegationRecord,
  TriggerDelegationStore,
} from "./triggerDelegationStore.ts";

/** SQLite-backed {@link TriggerDelegationStore} over the session metadata DB. */
export class SqliteTriggerDelegationStore implements TriggerDelegationStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  put(record: TriggerDelegationRecord): void {
    const row = { ...record, createdAt: new Date().toISOString() };
    this.db
      .insert(triggerDelegations)
      .values(row)
      .onConflictDoUpdate({
        target: [triggerDelegations.sessionId, triggerDelegations.triggerId],
        set: {
          participantId: row.participantId,
          delegationId: row.delegationId,
          token: row.token,
          createdAt: row.createdAt,
        },
      })
      .run();
  }

  get(
    sessionId: string,
    triggerId: string,
  ): TriggerDelegationRecord | undefined {
    const row = this.db
      .select()
      .from(triggerDelegations)
      .where(
        and(
          eq(triggerDelegations.sessionId, sessionId),
          eq(triggerDelegations.triggerId, triggerId),
        ),
      )
      .get();
    if (!row) return undefined;
    return {
      sessionId: row.sessionId,
      triggerId: row.triggerId,
      participantId: row.participantId,
      delegationId: row.delegationId,
      token: row.token,
    };
  }

  delete(sessionId: string, triggerId: string): void {
    this.db
      .delete(triggerDelegations)
      .where(
        and(
          eq(triggerDelegations.sessionId, sessionId),
          eq(triggerDelegations.triggerId, triggerId),
        ),
      )
      .run();
  }
}
