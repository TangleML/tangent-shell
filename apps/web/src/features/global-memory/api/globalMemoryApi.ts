import type {
  GetGlobalMemoryResponse,
  UpdateGlobalMemoryRequest,
  UpdateGlobalMemoryResponse,
} from "@tangent/shared/contracts";

import { apiUrl } from "@/shared/lib/basePath";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Fetches the current global memory file contents. */
export async function getGlobalMemory(): Promise<string> {
  const data = await parseJson<GetGlobalMemoryResponse>(
    await fetch(apiUrl("/api/global-memory")),
  );
  return data.content;
}

/** Overwrites the global memory file, returning the stored contents. */
export async function updateGlobalMemory(content: string): Promise<string> {
  const body: UpdateGlobalMemoryRequest = { content };
  const data = await parseJson<UpdateGlobalMemoryResponse>(
    await fetch(apiUrl("/api/global-memory"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return data.content;
}
