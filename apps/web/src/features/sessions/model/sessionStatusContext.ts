import type {
  AwaitingInput,
  SessionRunStatus,
} from "@tangent/shared/contracts";
import { createContext, useContext } from "react";

/** What the lobby says about one session that list views render. */
export interface SessionStatusEntry {
  status: SessionRunStatus;
  /** Set while Prime has unanswered questions in the session. */
  awaitingInput?: AwaitingInput;
}

/**
 * Live lobby status per session, keyed by session id. Seeded from the lobby
 * snapshot and kept current by `session:status` broadcasts. A session absent
 * from the map is `idle` (no Pi process running) with no pending questions.
 */
export type SessionStatusMap = ReadonlyMap<string, SessionStatusEntry>;

/** Defaults to an empty map so consumers rendered outside the provider (or
 * before the socket connects) simply read every session as `idle`. */
export const SessionStatusContext = createContext<SessionStatusMap>(new Map());

/** The live run status for a session, defaulting to `idle` when unknown. */
export function useSessionStatus(sessionId: string): SessionRunStatus {
  return useContext(SessionStatusContext).get(sessionId)?.status ?? "idle";
}

/** How many of Prime's questions in a session are unanswered, and since when;
 * undefined when none are. */
export function useSessionAwaitingInput(
  sessionId: string,
): AwaitingInput | undefined {
  return useContext(SessionStatusContext).get(sessionId)?.awaitingInput;
}
