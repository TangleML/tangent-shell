import { parseModelCatalog } from "@tangent/shared/modelCatalog";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/lib/apiFetch";

export function useModelCatalog() {
  return useQuery({
    queryKey: ["model-catalog"],
    queryFn: async () => {
      const response = await apiFetch("/api/config/models");
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error("Unable to load deployment model catalog");
      return parseModelCatalog(await response.json());
    },
    staleTime: 60000,
  });
}
