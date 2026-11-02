import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { searchMarketplace } from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export function useMarketplaceSearch(id: string, q: string, enabled = true) {
  return useQuery({
    queryKey: GlobalExtensionQueryKeys.Search(id, q),
    queryFn: () => searchMarketplace(id, q),
    enabled,
    placeholderData: keepPreviousData,
  });
}
