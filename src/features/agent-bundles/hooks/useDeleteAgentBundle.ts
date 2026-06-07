import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteAgentBundle } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

export function useDeleteAgentBundle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAgentBundle,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AgentBundleQueryKeys.All(),
      });
    },
  });
}
