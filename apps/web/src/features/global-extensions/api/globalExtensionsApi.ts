import type {
  GlobalExtensionMeta,
  InstallGlobalExtensionRequest,
  ListGlobalExtensionsResponse,
  ListMarketplacesResponse,
  MarketplaceListing,
  SearchMarketplaceResponse,
} from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

/** Throws with the server's `{ error }` message when the response failed. */
async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await res.json().catch(() => undefined)) as
    | { error?: string }
    | undefined;
  throw new Error(body?.error ?? `Request failed with status ${res.status}`);
}

export async function listGlobalExtensions(): Promise<GlobalExtensionMeta[]> {
  const res = await apiFetch("/api/extensions");
  await ensureOk(res);
  return ((await res.json()) as ListGlobalExtensionsResponse).extensions;
}

export async function listMarketplaces(): Promise<
  ListMarketplacesResponse["marketplaces"]
> {
  const res = await apiFetch("/api/extensions/marketplaces");
  await ensureOk(res);
  return ((await res.json()) as ListMarketplacesResponse).marketplaces;
}

export async function searchMarketplace(
  id: string,
  q: string,
): Promise<MarketplaceListing[]> {
  const res = await apiFetch(
    `/api/extensions/marketplaces/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`,
  );
  await ensureOk(res);
  return ((await res.json()) as SearchMarketplaceResponse).listings;
}

export async function installExtensionFromSource(
  body: InstallGlobalExtensionRequest,
): Promise<GlobalExtensionMeta> {
  const res = await apiFetch("/api/extensions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return ((await res.json()) as { extension: GlobalExtensionMeta }).extension;
}

export interface InstallFromFileInput {
  file: File;
  id?: string;
  tools?: string[];
  replace?: boolean;
}

export async function installExtensionFromFile(
  input: InstallFromFileInput,
): Promise<GlobalExtensionMeta> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.id) form.append("id", input.id);
  if (input.tools) form.append("tools", JSON.stringify(input.tools));
  if (input.replace) form.append("replace", "true");

  const res = await apiFetch("/api/extensions", { method: "POST", body: form });
  await ensureOk(res);
  return ((await res.json()) as { extension: GlobalExtensionMeta }).extension;
}

export interface UpdateExtensionInput {
  tools?: string[];
  name?: string;
}

export async function updateGlobalExtension(
  id: string,
  body: UpdateExtensionInput,
): Promise<GlobalExtensionMeta> {
  const res = await apiFetch(`/api/extensions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return ((await res.json()) as { extension: GlobalExtensionMeta }).extension;
}

export async function uninstallGlobalExtension(id: string): Promise<void> {
  const res = await apiFetch(`/api/extensions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await ensureOk(res);
}
