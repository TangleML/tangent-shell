import type { RunId, UsageTotals } from "@tangent/shared/contracts.ts";
import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import { usageEvents } from "./db/schema.ts";
import type {
  AgentUsageTotals,
  RecordUsageInput,
  RunUsageTotals,
  UsageStore,
  UsageSummary,
} from "./usageStore.ts";

/** The summed columns shared by the total and the grouped queries. */
const totalsColumns = {
  inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
  outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
  cacheReadTokens: sql<number>`coalesce(sum(${usageEvents.cacheReadTokens}), 0)`,
  cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)`,
  totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)`,
  costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
};

/** Maps a summed-columns row onto the wire {@link UsageTotals}. */
function toTotals(
  row: Record<keyof typeof totalsColumns, number>,
): UsageTotals {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
  };
}

/** SQLite-backed {@link UsageStore} over the shared session metadata DB. */
export class SqliteUsageStore implements UsageStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async record(input: RecordUsageInput): Promise<void> {
    const { usage } = input;
    this.db
      .insert(usageEvents)
      .values({
        sessionId: input.sessionId,
        agentId: input.agentId,
        runId: input.runId ?? null,
        model: input.model ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        costUsd: usage.costUsd,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  async summarize(sessionId: string): Promise<UsageSummary> {
    return {
      total: this.totalFor(sessionId),
      byAgent: this.byAgentFor(sessionId),
      byRun: this.byRunFor(sessionId),
    };
  }

  private totalFor(sessionId: string): UsageTotals {
    const row = this.db
      .select(totalsColumns)
      .from(usageEvents)
      .where(eq(usageEvents.sessionId, sessionId))
      .get();
    return toTotals(row ?? zeroRow());
  }

  private byAgentFor(sessionId: string): AgentUsageTotals[] {
    const rows = this.db
      .select({ agentId: usageEvents.agentId, ...totalsColumns })
      .from(usageEvents)
      .where(eq(usageEvents.sessionId, sessionId))
      .groupBy(usageEvents.agentId)
      .all();
    return rows.map((row) => ({ agentId: row.agentId, totals: toTotals(row) }));
  }

  private byRunFor(sessionId: string): RunUsageTotals[] {
    const scoped: SQL = and(
      eq(usageEvents.sessionId, sessionId),
      isNotNull(usageEvents.runId),
    )!;
    const rows = this.db
      .select({ runId: usageEvents.runId, ...totalsColumns })
      .from(usageEvents)
      .where(scoped)
      .groupBy(usageEvents.runId)
      .all();
    return rows.map((row) => ({
      runId: row.runId as RunId,
      totals: toTotals(row),
    }));
  }
}

/** The zero aggregate, for a session the `sum()` query found no rows for. */
function zeroRow(): Record<keyof typeof totalsColumns, number> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}
