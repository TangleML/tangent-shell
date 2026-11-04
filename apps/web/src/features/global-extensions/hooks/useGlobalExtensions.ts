import { useQuery } from "@tanstack/react-query";

import { listGlobalExtensions } from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export function useGlobalExtensions() {
  return useQuery({
    queryKey: GlobalExtensionQueryKeys.List(),
    queryFn: listGlobalExtensions,
  });
}
