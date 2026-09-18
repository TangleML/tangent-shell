import { useQuery } from "@tanstack/react-query";

import {
  getWorkflow,
  type ResourceScope,
} from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

/**
 * A Conversation's workflow state — the reactors, open Runs, waves,
 * correlations, digests, and causes the debugging panel renders. A `scope`
 * narrows it to the Conversation in view; adding a `participantId` attaches
 * that Participant's projected room.
 *
 * The transient facts (waves, admission depth, correlations) are process-local
 * with no socket event, so this polls on an interval; the log-derived facts
 * (causes, digests) also refresh when {@link import("./useSessionChat")} sees a
 * message or resource signal and invalidates this key.
 */
export function useSessionWorkflow(sessionId: string, scope?: ResourceScope) {
  return useQuery({
    queryKey: SessionQueryKeys.Workflow(sessionId, scope),
    queryFn: () => getWorkflow(sessionId, scope),
    enabled: sessionId.length > 0,
    refetchInterval: 5000,
  });
}
