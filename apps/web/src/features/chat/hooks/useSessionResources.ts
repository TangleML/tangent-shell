import { useQuery } from "@tanstack/react-query";

import { listResources } from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

/**
 * The session's catalogued resources (artifacts, attachments, memory documents,
 * workspace files). Fetched over REST and kept fresh by invalidating its key
 * from {@link import("./useSessionChat").useSessionChat} whenever a socket
 * signal implies the catalog changed (a pin, an attachment, a memory write).
 */
export function useSessionResources(sessionId: string) {
  return useQuery({
    queryKey: SessionQueryKeys.Resources(sessionId),
    queryFn: () => listResources(sessionId),
    enabled: sessionId.length > 0,
  });
}
