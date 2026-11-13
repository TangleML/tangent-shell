import { useQuery } from "@tanstack/react-query";

import { listMarketplaces } from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export function useExtensionMarketplaces() {
  return useQuery({
    queryKey: GlobalExtensionQueryKeys.Marketplaces(),
    queryFn: listMarketplaces,
  });
}
