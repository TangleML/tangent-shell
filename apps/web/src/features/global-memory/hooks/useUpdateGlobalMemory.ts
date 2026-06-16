import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateGlobalMemory } from "@/features/global-memory/api/globalMemoryApi";
import { GlobalMemoryQueryKeys } from "@/features/global-memory/model/globalMemoryQueryKeys";

export function useUpdateGlobalMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateGlobalMemory,
    onSuccess: (content) => {
      queryClient.setQueryData(GlobalMemoryQueryKeys.All(), content);
    },
  });
}
