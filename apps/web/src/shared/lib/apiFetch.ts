import { apiUrl, getAuthToken } from "@/shared/lib/basePath";
import { identityFreshness } from "@/shared/lib/identityRefresh";

/**
 * Central HTTP client for the Tangent REST API. Resolves the path against the
 * active API base ({@link apiUrl}) and attaches the embed bearer token as
 * `Authorization: Bearer` when a token getter is configured. In the standalone
 * SPA no token resolves, so this is an ordinary same-origin `fetch`.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await Promise.resolve(getAuthToken());
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  identityFreshness.noteRequest();
  return fetch(apiUrl(path), { ...init, headers });
}
