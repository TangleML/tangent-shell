import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type UpdateExtensionInput,
  updateGlobalExtension,
} from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export function useUpdateGlobalExtension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExtensionInput }) =>
      updateGlobalExtension(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: GlobalExtensionQueryKeys.All(),
      });
    },
  });
}
