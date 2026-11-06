/** Sends JSON (POST when `body` is set, else GET) and returns the parsed reply. */
export async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`${url} failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

/** Each origin signs in on its own, so callers pick a fetch per URL. */
export type FetchFor = (url: string) => typeof fetch;
