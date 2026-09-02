import type {
  ReactorRecord,
  ReactorScope,
  ReactorSpec,
  ReactorState,
} from "@tangent/shared/contracts.ts";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { reactorState, type ReactorStateRow } from "./db/schema.ts";
import { type ReactorStore, scopeKeyFor } from "./reactorStore.ts";

/** Maps a reactor_state row onto the domain {@link ReactorRecord}. */
function toRecord(row: ReactorStateRow): ReactorRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    participantId: row.participantId,
    homeConversationId: row.homeConversationId,
    spec: JSON.parse(row.spec) as ReactorSpec,
    scope: JSON.parse(row.scope) as ReactorScope,
    state: JSON.parse(row.state) as ReactorState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** SQLite-backed {@link ReactorStore} over the shared session metadata DB. */
export class SqliteReactorStore implements ReactorStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async put(record: ReactorRecord): Promise<void> {
    const spec = JSON.stringify(record.spec);
    const scope = JSON.stringify(record.scope);
    const state = JSON.stringify(record.state);
    this.db
      .insert(reactorState)
      .values({
        id: record.id,
        sessionId: record.sessionId,
        participantId: record.participantId,
        homeConversationId: record.homeConversationId,
        scopeKey: scopeKeyFor(record),
        spec,
        scope,
        state,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          reactorState.sessionId,
          reactorState.participantId,
          reactorState.scopeKey,
        ],
        set: { spec, scope, state, updatedAt: record.updatedAt },
      })
      .run();
  }

  async get(id: string): Promise<ReactorRecord | undefined> {
    const row = this.db
      .select()
      .from(reactorState)
      .where(eq(reactorState.id, id))
      .get();
    return row ? toRecord(row) : undefined;
  }

  async listForSession(sessionId: string): Promise<ReactorRecord[]> {
    const rows = this.db
      .select()
      .from(reactorState)
      .where(eq(reactorState.sessionId, sessionId))
      .orderBy(asc(reactorState.createdAt))
      .all();
    return rows.map(toRecord);
  }

  async listForParticipant(
    sessionId: string,
    participantId: string,
  ): Promise<ReactorRecord[]> {
    const rows = this.db
      .select()
      .from(reactorState)
      .where(
        and(
          eq(reactorState.sessionId, sessionId),
          eq(reactorState.participantId, participantId),
        ),
      )
      .orderBy(asc(reactorState.createdAt))
      .all();
    return rows.map(toRecord);
  }

  async listObserving(
    sessionId: string,
    conversationId: string,
  ): Promise<ReactorRecord[]> {
    // The scope is a JSON blob, so filtering happens in JS rather than SQL:
    // reactors are few per session, and a membership match is exact, not fuzzy.
    const rows = await this.listForSession(sessionId);
    return rows.filter((record) =>
      record.scope.memberships.some(
        (member) => member.conversationId === conversationId,
      ),
    );
  }

  async remove(id: string): Promise<void> {
    this.db.delete(reactorState).where(eq(reactorState.id, id)).run();
  }
}
