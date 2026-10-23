import { useQuery } from "@tanstack/react-query";

import { BASE_PREFIX } from "@/shared/lib/basePath";

import { getPublicConfig } from "./publicConfigApi";

/**
 * The Tangent Shell's public base URL, without a trailing slash — the value an
 * attach command must dial. Resolved from `GET /api/config` so it is correct in
 * embedded mode, where `window.location.origin` is the host page's origin rather
 * than Tangent's. Falls back to this app's own origin + mount prefix while the
 * config loads or when `TANGENT_PUBLIC_URL` is unset (standalone dev).
 */
export function useShellUrl(): string {
  const { data } = useQuery({
    queryKey: ["public-config"],
    queryFn: getPublicConfig,
    staleTime: Infinity,
  });
  return (
    data?.shellUrl ||
    `${window.location.origin}${BASE_PREFIX}`.replace(/\/$/, "")
  );
}
