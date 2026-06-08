import { useQuery } from "@tanstack/react-query";

import { getAgentBundle } from "@/features/agent-bundles/api/agentBundlesApi";
import { AgentBundleQueryKeys } from "@/features/agent-bundles/model/agentBundleQueryKeys";

/** Fetches a single bundle's metadata (including its UI `components`) by id. */
export function useAgentBundle(id: string | undefined) {
  return useQuery({
    queryKey: AgentBundleQueryKeys.Id(id ?? ""),
    queryFn: () => getAgentBundle(id as string),
    enabled: Boolean(id),
  });
}
