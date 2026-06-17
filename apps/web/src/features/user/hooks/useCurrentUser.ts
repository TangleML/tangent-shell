import type { UserIdentity } from "@tangent/shared/contracts";
import { useQuery } from "@tanstack/react-query";

import { getMe } from "@/features/user/api/userApi";
import { DEFAULT_USER } from "@/features/user/model/userDisplay";
import { UserQueryKeys } from "@/features/user/model/userQueryKeys";

/**
 * The current human's identity, resolved from `GET /api/me`. Always returns a
 * {@link UserIdentity}: {@link DEFAULT_USER} while loading or when the JWT is
 * unavailable. The identity is stable for the session, so it never goes stale.
 */
export function useCurrentUser(): UserIdentity {
  const { data } = useQuery({
    queryKey: UserQueryKeys.Me(),
    queryFn: getMe,
    staleTime: Infinity,
  });
  return data ?? DEFAULT_USER;
}
