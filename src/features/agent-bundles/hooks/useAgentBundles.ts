import { useQuery } from "@tanstack/react-query";

import { listAgentBundles } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

export function useAgentBundles() {
  return useQuery({
    queryKey: AgentBundleQueryKeys.All(),
    queryFn: listAgentBundles,
  });
}
