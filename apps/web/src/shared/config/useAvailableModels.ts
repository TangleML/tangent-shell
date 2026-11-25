import type { AvailableModelsResponse } from "@tangent/shared/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/lib/apiFetch";

/** Models Pi can resolve, for installations without a deployment catalog. */
export function useAvailableModels(enabled: boolean) {
  return useQuery({
    queryKey: ["available-models"],
    queryFn: async () => {
      const response = await apiFetch("/api/config/available-models");
      if (!response.ok) throw new Error("Unable to load available models");
      const body = (await response.json()) as AvailableModelsResponse;
      return body.models;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
