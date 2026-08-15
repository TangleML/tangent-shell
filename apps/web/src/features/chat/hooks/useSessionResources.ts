import { useQuery } from "@tanstack/react-query";

import {
  listResources,
  type ResourceScope,
} from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

/**
 * The session's catalogued resources (artifacts, attachments, memory documents,
 * workspace files). Fetched over REST and kept fresh by invalidating its key
 * from {@link import("./useSessionChat").useSessionChat} whenever a socket
 * signal implies the catalog changed (a pin, an attachment, a memory write).
 *
 * A `scope` narrows the catalog to one Conversation + Participant, so surfacing
 * consults their grants; the invalidations key off the shared prefix, so a
 * scoped query still refreshes on those signals.
 */
export function useSessionResources(sessionId: string, scope?: ResourceScope) {
  return useQuery({
    queryKey: SessionQueryKeys.Resources(sessionId, scope),
    queryFn: () => listResources(sessionId, scope),
    enabled: sessionId.length > 0,
  });
}
