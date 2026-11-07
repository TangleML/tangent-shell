import type { ReinstallBundleRequest } from "@tangent/shared/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { reinstallSessionBundle } from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

interface ReinstallBundleVariables {
  id: string;
  input: ReinstallBundleRequest;
}

/** Reinstalls a session's bundle (restarting Prime), then refreshes its caches. */
export function useReinstallBundle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: ReinstallBundleVariables) =>
      reinstallSessionBundle(id, input),
    onSuccess: ({ session }) => {
      queryClient.setQueryData(SessionQueryKeys.Id(session.id), session);
      void queryClient.invalidateQueries({ queryKey: SessionQueryKeys.All() });
    },
  });
}
