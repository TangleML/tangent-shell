import type { Resource, ResourceKind } from "@tangent/shared/contracts.ts";

// The wire-facing shape lives in `@tangent/shared` now that the web surfaces the
// catalog; re-exported here so server modules keep their existing import site.
export type { Resource, ResourceKind } from "@tangent/shared/contracts.ts";

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
 * A per-Membership grant: one Participant may be shown and may cite one of a
 * Conversation's referenced {@link Resource}s. The refinement of a Membership's
 * view; default-permissive, so a Membership with no grants surfaces every
 * reference (unified-model §4.4).
 */
export interface ResourceGrant {
  sessionId: string;
  conversationId: string;
  participantId: string;
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
   * Catalogs a resource only when `(sessionId, uri)` is not already known,
   * returning the stored row either way. Unlike {@link ResourceStore.catalog}
   * this never overwrites an existing entry, so a workspace-file scan cannot
   * downgrade a path already catalogued as an `artifact` or `attachment`.
   */
  catalogIfAbsent(input: CatalogInput): Promise<Resource>;
  /**
   * Removes a resource by `(sessionId, uri)`, cascading its references. A no-op
   * when nothing is catalogued there.
   */
  remove(sessionId: string, uri: string): Promise<void>;
  /** Upserts a reference by `(conversationId, resourceId)`. */
  reference(ref: ResourceReference): Promise<void>;
  /**
   * Grants one Participant sight of one referenced resource in a Conversation.
   * Idempotent by `(conversationId, participantId, resourceId)`.
   */
  grant(grant: ResourceGrant): Promise<void>;
  /** Revokes a grant. A no-op when there is none to revoke. */
  revoke(grant: ResourceGrant): Promise<void>;
  /** The resource ids one Membership has been granted, if any. */
  listGrants(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<string[]>;
  /** Every catalogued resource in a session, oldest first. */
  listForSession(sessionId: string): Promise<Resource[]>;
  /** Every resource referenced in one Conversation, oldest referenced first. */
  listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]>;
}
