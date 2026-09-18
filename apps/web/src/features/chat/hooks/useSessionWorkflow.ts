import type { WorkflowView } from "@tangent/shared/contracts";
import { useQuery } from "@tanstack/react-query";

import {
  getWorkflow,
  type ResourceScope,
} from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

const POLL_INTERVAL_MS = 5000;

/** Whether the workflow holds live state worth polling for. Reactors, open Runs,
 * waves, and correlations are the transient facts that change without a socket
 * event; when none are outstanding the poll stops and a message, resource, or
 * agent-error signal invalidates this key to restart it. */
function hasOutstandingWork(view: WorkflowView | undefined): boolean {
  if (!view) return true;
  return (
    view.runs.length > 0 ||
    view.waves.length > 0 ||
    view.correlations.length > 0 ||
    view.reactors.length > 0
  );
}

/**
 * A Conversation's workflow state — the reactors, open Runs, waves,
 * correlations, digests, and causes the debugging panel renders. A `scope`
 * narrows it to the Conversation in view; adding a `participantId` attaches
 * that Participant's projected room.
 *
 * The transient facts (waves, admission depth, correlations) are process-local
 * with no socket event, so this polls while any are outstanding; the log-derived
 * facts (causes, digests) also refresh when {@link import("./useSessionChat")}
 * sees a message or resource signal and invalidates this key. Once nothing is
 * outstanding the poll backs off, so an idle session stops hitting the server.
 */
export function useSessionWorkflow(sessionId: string, scope?: ResourceScope) {
  return useQuery({
    queryKey: SessionQueryKeys.Workflow(sessionId, scope),
    queryFn: () => getWorkflow(sessionId, scope),
    enabled: sessionId.length > 0,
    refetchInterval: (query) =>
      hasOutstandingWork(query.state.data) ? POLL_INTERVAL_MS : false,
  });
}
