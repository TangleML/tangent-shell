import { useQuery } from "@tanstack/react-query";

import { gravatarUrl } from "@/features/user/model/gravatar";
import { UserQueryKeys } from "@/features/user/model/userQueryKeys";

const AVATAR_SIZE = 32;

/**
 * Resolves a Gravatar image URL for `email`, or `null` when none exists.
 * Preloads the image with `new Image()` so a 404 (`d=404`) surfaces as `null`
 * via `onerror` without the CORS problems a `fetch` would hit. The result is
 * cached indefinitely. `undefined` means the lookup is still in flight.
 */
export function useGravatar(email: string): string | null | undefined {
  const { data } = useQuery({
    queryKey: UserQueryKeys.Gravatar(email),
    queryFn: () => resolveGravatar(email),
    enabled: !!email,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return data;
}

async function resolveGravatar(email: string): Promise<string | null> {
  const url = await gravatarUrl(email, AVATAR_SIZE);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
