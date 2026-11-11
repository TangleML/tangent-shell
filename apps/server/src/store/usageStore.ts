import type { RunId, UsageTotals } from "@tangent/shared/contracts.ts";

/** The accounting a caller appends as one assistant message finalizes. */
export interface RecordUsageInput {
  sessionId: string;
  /** The agent that produced the message (`prime` or a sub-agent id). */
  agentId: string;
  /** The Run the turn was attributed to, when one was open. */
  runId?: RunId;
  /** The model that served the call, when known. */
  model?: string;
  usage: UsageTotals;
}

/** One agent's summed spend, before name/purpose enrichment. */
export interface AgentUsageTotals {
  agentId: string;
  totals: UsageTotals;
}

/** One Run's summed spend, before ingress/status enrichment. */
export interface RunUsageTotals {
  runId: RunId;
  totals: UsageTotals;
}

/**
 * A session's spend already rolled up by the store: the grand total plus the
 * per-agent and per-Run groupings. The route handler enriches these raw ids
 * with roster/run metadata; the store stays unaware of either.
 */
export interface UsageSummary {
  total: UsageTotals;
  byAgent: AgentUsageTotals[];
  byRun: RunUsageTotals[];
}

/**
 * Durable home of per-message token/cost accounting. Written on the streaming
 * hot path as a turn finalizes and read by the usage route. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason as
 * {@link import("./runStore.ts").RunStore}: it is not session metadata.
 */
export interface UsageStore {
  /** Appends one assistant message's accounting. */
  record(input: RecordUsageInput): Promise<void>;
  /** Rolls a session's events up into a {@link UsageSummary}. */
  summarize(sessionId: string): Promise<UsageSummary>;
}

/** The zero {@link UsageTotals}, the identity for a session with no spend. */
export function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}
