import type {
  AddBundleEditorRequest,
  AddBundleEditorResponse,
  BundleEditor,
  ListBundleEditorsResponse,
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

export async function listBundleEditors(): Promise<ListBundleEditorsResponse> {
  const res = await apiFetch("/api/bundle-editors");
  await ensureOk(res);
  return (await res.json()) as ListBundleEditorsResponse;
}

export async function addBundleEditor(email: string): Promise<BundleEditor> {
  const body: AddBundleEditorRequest = { email };
  const res = await apiFetch("/api/bundle-editors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return ((await res.json()) as AddBundleEditorResponse).editor;
}

export async function removeBundleEditor(email: string): Promise<void> {
  const res = await apiFetch(
    `/api/bundle-editors/${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
  await ensureOk(res);
}
