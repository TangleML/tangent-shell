/** What a catalogued resource is: content the session holds, by origin. */
export type ResourceKind = "file" | "memory" | "attachment" | "artifact";

/**
 * A catalogued piece of content in a session — a pinned `artifact`, a human
 * `attachment`, a `memory` document, or a workspace `file` — regardless of which
 * connector or mechanism produced it. The bytes stay where they are; this is the
 * catalog entry that points at them by {@link Resource.uri}.
 */
export interface Resource {
  id: string;
  sessionId: string;
  kind: ResourceKind;
  /** Display name / title. */
  name: string;
  /**
   * Where the content lives: a path relative to the session root (e.g.
   * `artifacts/report.html`) or a `memory://session` / `memory://global` scheme.
   */
  uri: string;
  /** The participant that produced it, when known. */
  authorParticipantId?: string;
  /** Kind-specific facts (e.g. `contentType`, `size`, `scope`). */
  meta?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Fields accepted when cataloguing. The store assigns `id` and `createdAt` the
 * first time a `(sessionId, uri)` is seen and preserves them on re-catalogue.
 */
export interface CatalogInput {
  sessionId: string;
  kind: ResourceKind;
  name: string;
  uri: string;
  authorParticipantId?: string;
  meta?: Record<string, unknown>;
}

/** A {@link Resource} surfaced in one Conversation. */
export interface ResourceReference {
  sessionId: string;
  conversationId: string;
  resourceId: string;
}

/**
 * Durable home of the session's {@link Resource}s and the Conversations they are
 * referenced in. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason
 * {@link import("./membershipStore.ts").MembershipStore} is: it is written
 * through by a small catalog on the content paths, not read by the REST routes.
 * The existing mechanisms (`session_assets`, message attachments, memory files)
 * stay the write authority for this PR and mirror into it.
 */
export interface ResourceStore {
  /**
   * Upserts a resource by `(sessionId, uri)`, returning the stored row.
   * Re-cataloguing a known uri refreshes `name`/`authorParticipantId`/`meta`
   * while keeping the original `id` and `createdAt`.
   */
  catalog(input: CatalogInput): Promise<Resource>;
  /**
   * Removes a resource by `(sessionId, uri)`, cascading its references. A no-op
   * when nothing is catalogued there.
   */
  remove(sessionId: string, uri: string): Promise<void>;
  /** Upserts a reference by `(conversationId, resourceId)`. */
  reference(ref: ResourceReference): Promise<void>;
  /** Every catalogued resource in a session, oldest first. */
  listForSession(sessionId: string): Promise<Resource[]>;
  /** Every resource referenced in one Conversation, oldest referenced first. */
  listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]>;
}
