import { useQuery } from "@tanstack/react-query";

import { listBundleEditors } from "@/features/bundle-editors/api/bundleEditorsApi";
import { BundleEditorQueryKeys } from "@/features/bundle-editors/model/bundleEditorQueryKeys";

export function useBundleEditors() {
  return useQuery({
    queryKey: BundleEditorQueryKeys.All(),
    queryFn: listBundleEditors,
  });
}
