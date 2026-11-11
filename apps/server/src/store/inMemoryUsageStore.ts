import type { RunId, UsageTotals } from "@tangent/shared/contracts.ts";

import {
  type AgentUsageTotals,
  emptyTotals,
  type RecordUsageInput,
  type RunUsageTotals,
  type UsageStore,
  type UsageSummary,
} from "./usageStore.ts";

/** One appended accounting event, as held in memory. */
interface UsageEvent {
  sessionId: string;
  agentId: string;
  runId?: RunId;
  usage: UsageTotals;
}

/** Folds one event's totals into an accumulator in place. */
function add(into: UsageTotals, usage: UsageTotals): void {
  into.inputTokens += usage.inputTokens;
  into.outputTokens += usage.outputTokens;
  into.cacheReadTokens += usage.cacheReadTokens;
  into.cacheWriteTokens += usage.cacheWriteTokens;
  into.totalTokens += usage.totalTokens;
  into.costUsd += usage.costUsd;
}

/** Returns the accumulator for `key`, creating a zero one on first sight. */
function bucket(map: Map<string, UsageTotals>, key: string): UsageTotals {
  const existing = map.get(key);
  if (existing) return existing;
  const fresh = emptyTotals();
  map.set(key, fresh);
  return fresh;
}

/**
 * Process-local {@link UsageStore}, mirroring {@link
 * import("./inMemoryRunStore.ts").InMemoryRunStore}. For tests and for wiring a
 * usage sink that has no DB to write to.
 */
export class InMemoryUsageStore implements UsageStore {
  private readonly events: UsageEvent[] = [];

  async record(input: RecordUsageInput): Promise<void> {
    this.events.push({
      sessionId: input.sessionId,
      agentId: input.agentId,
      runId: input.runId,
      usage: input.usage,
    });
  }

  async summarize(sessionId: string): Promise<UsageSummary> {
    const total = emptyTotals();
    const agents = new Map<string, UsageTotals>();
    const runs = new Map<string, UsageTotals>();

    for (const event of this.events) {
      if (event.sessionId !== sessionId) continue;
      add(total, event.usage);
      add(bucket(agents, event.agentId), event.usage);
      if (event.runId) add(bucket(runs, event.runId), event.usage);
    }

    const byAgent: AgentUsageTotals[] = [...agents].map(
      ([agentId, totals]) => ({
        agentId,
        totals,
      }),
    );
    const byRun: RunUsageTotals[] = [...runs].map(([runId, totals]) => ({
      runId,
      totals,
    }));
    return { total, byAgent, byRun };
  }
}
