import { useMutation, useQueryClient } from "@tanstack/react-query";

import { removeBundleEditor } from "@/features/bundle-editors/api/bundleEditorsApi";
import { BundleEditorQueryKeys } from "@/features/bundle-editors/model/bundleEditorQueryKeys";

export function useRemoveBundleEditor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeBundleEditor,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: BundleEditorQueryKeys.All(),
      });
    },
  });
}
