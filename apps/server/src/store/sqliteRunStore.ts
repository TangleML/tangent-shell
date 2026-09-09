import type {
  Run,
  RunId,
  RunIngress,
  RunStatus,
} from "@tangent/shared/contracts.ts";
import { asc, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { type RunRow, runs } from "./db/schema.ts";
import type { CreateRunInput, RunStore, UpdateRunInput } from "./runStore.ts";

/** Maps a runs row onto the wire {@link Run}. */
function toRun(row: RunRow): Run {
  return {
    id: row.id,
    sessionId: row.sessionId,
    participantId: row.participantId,
    homeConversationId: row.homeConversationId,
    status: row.status as RunStatus,
    ingress: row.ingress as RunIngress,
    externalId: row.externalId ?? undefined,
    cursor: row.cursor ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    endedAt: row.endedAt ?? undefined,
  };
}

/** SQLite-backed {@link RunStore} over the shared session metadata DB. */
export class SqliteRunStore implements RunStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const now = new Date().toISOString();
    const row: RunRow = {
      id: input.id,
      sessionId: input.sessionId,
      participantId: input.participantId,
      homeConversationId: input.homeConversationId,
      status: "running",
      ingress: input.ingress,
      externalId: input.externalId ?? null,
      cursor: input.cursor ?? null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    this.db.insert(runs).values(row).run();
    return toRun(row);
  }

  async updateRun(id: RunId, input: UpdateRunInput): Promise<void> {
    // Drizzle omits `undefined` fields, so an absent field leaves the stored
    // value untouched.
    this.db
      .update(runs)
      .set({
        status: input.status,
        externalId: input.externalId,
        cursor: input.cursor,
        endedAt: input.endedAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(runs.id, id))
      .run();
  }

  async getRun(id: RunId): Promise<Run | undefined> {
    const row = this.db.select().from(runs).where(eq(runs.id, id)).get();
    return row ? toRun(row) : undefined;
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    const rows = this.db
      .select()
      .from(runs)
      .where(eq(runs.sessionId, sessionId))
      .orderBy(asc(runs.createdAt))
      .all();
    return rows.map(toRun);
  }

  async failStaleRuns(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .update(runs)
      .set({ status: "failed", endedAt: now, updatedAt: now })
      .where(eq(runs.status, "running"))
      .run();
    return result.changes;
  }
}
