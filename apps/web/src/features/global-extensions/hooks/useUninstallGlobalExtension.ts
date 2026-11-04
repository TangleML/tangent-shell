import { useMutation, useQueryClient } from "@tanstack/react-query";

import { uninstallGlobalExtension } from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export function useUninstallGlobalExtension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uninstallGlobalExtension,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: GlobalExtensionQueryKeys.All(),
      });
    },
  });
}
