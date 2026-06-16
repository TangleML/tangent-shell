import { useQuery } from "@tanstack/react-query";

import { getGlobalMemory } from "@/features/global-memory/api/globalMemoryApi";
import { GlobalMemoryQueryKeys } from "@/features/global-memory/model/globalMemoryQueryKeys";

export function useGlobalMemory() {
  return useQuery({
    queryKey: GlobalMemoryQueryKeys.All(),
    queryFn: getGlobalMemory,
  });
}
