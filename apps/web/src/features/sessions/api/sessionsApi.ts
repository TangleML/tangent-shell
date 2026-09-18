import type {
  AddResourceResponse,
  Attachment,
  CreateSessionRequest,
  HostResourceInput,
  ListParticipantsResponse,
  ListResourcesResponse,
  MembershipView,
  ParticipantView,
  ParticipantWithMemberships,
  Resource,
  Session,
  UpdateSessionRequest,
  UploadFilesResponse,
  WorkflowView,
  WorkflowViewResponse,
} from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

export type CreateSessionInput = CreateSessionRequest;

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listSessions(): Promise<Session[]> {
  const data = await parseJson<{ sessions: Session[] }>(
    await apiFetch("/api/sessions"),
  );
  return data.sessions;
}

export async function getSession(id: string): Promise<Session> {
  const data = await parseJson<{ session: Session }>(
    await apiFetch(`/api/sessions/${id}`),
  );
  return data.session;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<Session> {
  const data = await parseJson<{ session: Session }>(
    await apiFetch("/api/sessions", {
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
    await apiFetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data.session;
}

/**
 * Uploads files into a session's workspace, returning their stored metadata
 * (workspace-relative paths) so they can ride along on a chat message. Sent as
 * multipart with one repeated `files` field per file.
 */
export async function uploadFiles(
  sessionId: string,
  files: File[],
): Promise<Attachment[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);

  const data = await parseJson<UploadFilesResponse>(
    await apiFetch(`/api/sessions/${sessionId}/files`, {
      method: "POST",
      body: form,
    }),
  );
  return data.files;
}

/**
 * Fetches the raw text of a session artifact by its resolved file API URL.
 * Used to render text-based artifacts (e.g. Markdown documents) inline.
 */
export async function getArtifactText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res.text();
}

/**
 * Lists a session's catalogued resources — pinned artifacts, human attachments,
 * memory documents, and workspace files — regardless of which mechanism
 * produced them. The server scans the workspace before returning, so the list
 * reflects what is on disk at request time.
 */
/** Optional scope narrowing the catalog to one Conversation + Participant. */
export interface ResourceScope {
  conversationId?: string;
  participantId?: string;
}

export async function listResources(
  sessionId: string,
  scope?: ResourceScope,
): Promise<Resource[]> {
  const params = new URLSearchParams();
  if (scope?.conversationId && scope.participantId) {
    params.set("conversationId", scope.conversationId);
    params.set("participantId", scope.participantId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await parseJson<ListResourcesResponse>(
    await apiFetch(`/api/sessions/${sessionId}/resources${suffix}`),
  );
  return data.resources;
}

/**
 * Adds one resource to a session — a memory write or a host entry (e.g. a known
 * pipeline). Returns the stored resource; re-adding the same `uri` updates it.
 */
export async function addResource(
  sessionId: string,
  input: HostResourceInput,
): Promise<Resource> {
  const data = await parseJson<AddResourceResponse>(
    await apiFetch(`/api/sessions/${sessionId}/resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data.resource;
}

/** Removes a resource by its `uri`. Removing a memory store clears it. */
export async function removeResource(
  sessionId: string,
  uri: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/sessions/${sessionId}/resources?uri=${encodeURIComponent(uri)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to remove resource (status ${res.status})`);
  }
}

/**
 * Reads a Conversation's (or the whole Session's) workflow state — the folded
 * roster of reactors, open Runs, live waves, outstanding correlations, digest
 * coverage, and structured causes the debugging surface renders. A `scope`
 * narrows it to one Conversation; adding a `participantId` (alongside the
 * conversation) attaches that Participant's projected room read.
 */
export async function getWorkflow(
  sessionId: string,
  scope?: ResourceScope,
): Promise<WorkflowView> {
  const params = new URLSearchParams();
  if (scope?.conversationId) {
    params.set("conversationId", scope.conversationId);
    if (scope.participantId) params.set("participantId", scope.participantId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await parseJson<WorkflowViewResponse>(
    await apiFetch(`/api/sessions/${sessionId}/workflow${suffix}`),
  );
  return data.workflow;
}

/**
 * Lists the session's Participants (humans, agents, automations) each with their
 * Memberships. The roster reads this to show who is present and where.
 */
export async function listParticipants(
  sessionId: string,
): Promise<ParticipantWithMemberships[]> {
  const data = await parseJson<ListParticipantsResponse>(
    await apiFetch(`/api/sessions/${sessionId}/participants`),
  );
  return data.participants;
}

export interface InviteParticipantInput {
  email: string;
  displayName?: string;
  conversationIds?: string[];
}

/** Invites a person into the session by email (idempotent per email). */
export async function inviteParticipant(
  sessionId: string,
  input: InviteParticipantInput,
): Promise<ParticipantView> {
  const data = await parseJson<{ participant: ParticipantView }>(
    await apiFetch(`/api/sessions/${sessionId}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data.participant;
}

/** Revokes a Participant, removing their Memberships and marking them detached. */
export async function revokeParticipant(
  sessionId: string,
  participantId: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/sessions/${sessionId}/participants/${participantId}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to revoke participant (status ${res.status})`);
  }
}

/** Adds a Membership so the Participant belongs to one more Conversation. */
export async function joinMembership(
  sessionId: string,
  participantId: string,
  conversationId: string,
): Promise<MembershipView | null> {
  const data = await parseJson<{ membership: MembershipView | null }>(
    await apiFetch(
      `/api/sessions/${sessionId}/participants/${participantId}/memberships`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      },
    ),
  );
  return data.membership;
}

/** Removes one of a Participant's Memberships, leaving the others intact. */
export async function leaveMembership(
  sessionId: string,
  participantId: string,
  conversationId: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/sessions/${sessionId}/participants/${participantId}/memberships/${conversationId}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to leave membership (status ${res.status})`);
  }
}

/**
 * Mutes or unmutes an agent's Membership. Muting sets its reaction to `never`
 * so the agent no longer wakes in that Conversation; only agent Memberships are
 * mutable server-side.
 */
export async function muteMembership(
  sessionId: string,
  participantId: string,
  conversationId: string,
  muted: boolean,
): Promise<MembershipView> {
  const data = await parseJson<{ membership: MembershipView }>(
    await apiFetch(
      `/api/sessions/${sessionId}/participants/${participantId}/memberships/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ muted }),
      },
    ),
  );
  return data.membership;
}

export async function markSessionViewed(id: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}/viewed`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to mark session viewed (status ${res.status})`);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Failed to delete session (status ${res.status})`);
  }
}
