import { useQuery } from "@tanstack/react-query";

import { listSessions } from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

export function useSessions() {
  return useQuery({
    queryKey: SessionQueryKeys.All(),
    queryFn: listSessions,
  });
}
