import type { UserPermissions } from "@tangent/shared/contracts";
import { useQuery } from "@tanstack/react-query";

import { getMyPermissions, NO_PERMISSIONS } from "@/features/user/api/userApi";
import { UserQueryKeys } from "@/features/user/model/userQueryKeys";

/**
 * What the current human may manage (bundles, global memory, bundle editors).
 * Resolves to no permissions while loading or on error so the UI never offers
 * an action the server would refuse.
 */
export function useMyPermissions(): UserPermissions & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: UserQueryKeys.Permissions(),
    queryFn: getMyPermissions,
    staleTime: 5 * 60 * 1000,
  });
  return { ...(data ?? NO_PERMISSIONS), isLoading };
}
