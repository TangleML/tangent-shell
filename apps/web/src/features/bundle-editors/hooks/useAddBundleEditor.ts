import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addBundleEditor } from "@/features/bundle-editors/api/bundleEditorsApi";
import { BundleEditorQueryKeys } from "@/features/bundle-editors/model/bundleEditorQueryKeys";

export function useAddBundleEditor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addBundleEditor,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: BundleEditorQueryKeys.All(),
      });
    },
  });
}
