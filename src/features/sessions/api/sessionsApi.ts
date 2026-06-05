import type {
  CreateSessionRequest,
  Session,
  UpdateSessionRequest,
} from "@shared/contracts";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listSessions(): Promise<Session[]> {
  const data = await parseJson<{ sessions: Session[] }>(
    await fetch("/api/sessions"),
  );
  return data.sessions;
}

export async function getSession(id: string): Promise<Session> {
  const data = await parseJson<{ session: Session }>(
    await fetch(`/api/sessions/${id}`),
  );
  return data.session;
}

export async function createSession(
  input: CreateSessionRequest,
): Promise<Session> {
  const data = await parseJson<{ session: Session }>(
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data.session;
}

export async function updateSession(
  id: string,
  input: UpdateSessionRequest,
): Promise<Session> {
  const data = await parseJson<{ session: Session }>(
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data.session;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Failed to delete session (status ${res.status})`);
  }
}
