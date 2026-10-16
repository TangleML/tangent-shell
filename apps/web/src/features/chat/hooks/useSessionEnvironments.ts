import { useQuery } from "@tanstack/react-query";

import { listEnvironments } from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

/**
 * The connected remote environments this session can route to. Kept fresh by
 * invalidating its key whenever an `environment:update` socket signal arrives.
 */
export function useSessionEnvironments(sessionId: string) {
  return useQuery({
    queryKey: SessionQueryKeys.Environments(sessionId),
    queryFn: () => listEnvironments(sessionId),
    enabled: sessionId.length > 0,
  });
}
