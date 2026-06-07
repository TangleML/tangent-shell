import type {
  AgentBundleMeta,
  ListAgentBundlesResponse,
} from "@shared/contracts";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listAgentBundles(): Promise<AgentBundleMeta[]> {
  const data = await parseJson<ListAgentBundlesResponse>(
    await fetch("/api/agent-bundles"),
  );
  return data.bundles;
}

/** Uploads an agent bundle ZIP to the marketplace, returning its metadata. */
export async function uploadAgentBundle(file: File): Promise<AgentBundleMeta> {
  const form = new FormData();
  form.append("bundle", file);

  const data = await parseJson<{ bundle: AgentBundleMeta }>(
    await fetch("/api/agent-bundles", { method: "POST", body: form }),
  );
  return data.bundle;
}

export async function deleteAgentBundle(id: string): Promise<void> {
  const res = await fetch(`/api/agent-bundles/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Failed to delete agent bundle (status ${res.status})`);
  }
}

/** URL of a bundle's preview icon; only valid when {@link AgentBundleMeta.hasIcon}. */
export function agentBundleIconUrl(id: string): string {
  return `/api/agent-bundles/${id}/icon`;
}
