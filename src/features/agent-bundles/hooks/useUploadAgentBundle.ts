import { useMutation, useQueryClient } from "@tanstack/react-query";

import { uploadAgentBundle } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

export function useUploadAgentBundle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadAgentBundle,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AgentBundleQueryKeys.All(),
      });
    },
  });
}
