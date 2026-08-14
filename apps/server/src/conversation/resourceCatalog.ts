import type {
  CatalogInput,
  Resource,
  ResourceGrant,
  ResourceStore,
} from "../store/resourceStore.ts";

/**
 * The one way content enters the catalog. Fronts a
 * {@link import("../store/resourceStore.ts").ResourceStore} the way
 * {@link import("./membershipRegistry.ts").MembershipRegistry} fronts a
 * membership store, so the write paths (a pinned artifact, a message
 * attachment, a memory write) catalogue and reference content without touching
 * the store directly.
 *
 * A reference governs surfacing and citation, not filesystem access: it records
 * that a resource appears in a Conversation, and does not interpose on the tool
 * reads and writes an agent makes against the session root.
 */
export class ResourceCatalog {
  private readonly store: ResourceStore;

  constructor(store: ResourceStore) {
    this.store = store;
  }

  /** Catalogs content, returning the stored resource (id stable per uri). */
  async catalog(input: CatalogInput): Promise<Resource> {
    return this.store.catalog(input);
  }

  /** Catalogs content and surfaces it in one Conversation, in one call. */
  async catalogIn(
    conversationId: string,
    input: CatalogInput,
  ): Promise<Resource> {
    const resource = await this.store.catalog(input);
    await this.store.reference({
      sessionId: input.sessionId,
      conversationId,
      resourceId: resource.id,
    });
    return resource;
  }

  /** Catalogs content without overwriting an entry already at that uri. */
  async catalogIfAbsent(input: CatalogInput): Promise<Resource> {
    return this.store.catalogIfAbsent(input);
  }

  /** Drops a catalogued resource by `(sessionId, uri)`, cascading references. */
  async remove(sessionId: string, uri: string): Promise<void> {
    await this.store.remove(sessionId, uri);
  }

  /** Grants one Participant sight of one referenced resource in a Conversation. */
  async grant(grant: ResourceGrant): Promise<void> {
    await this.store.grant(grant);
  }

  /** Revokes a per-Membership grant. */
  async revoke(grant: ResourceGrant): Promise<void> {
    await this.store.revoke(grant);
  }

  /** Every catalogued resource in a session. */
  async listForSession(sessionId: string): Promise<Resource[]> {
    return this.store.listForSession(sessionId);
  }

  /** Every resource referenced in one Conversation. */
  async listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]> {
    return this.store.listForConversation(sessionId, conversationId);
  }

  /**
   * The resources one Membership may be shown and may cite in a Conversation.
   * Default-permissive: a Membership with no grants surfaces the Conversation's
   * whole reference set, so behaviour is unchanged until grants are written and
   * enforced (the latter lands with the multi-party transcript UI, 2.6). This is
   * the one place unified-model §4.4's "should this surface for this
   * Participant" is answered — it is not yet consulted by delivery.
   */
  async surfacedFor(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<Resource[]> {
    const referenced = await this.store.listForConversation(
      sessionId,
      conversationId,
    );
    const granted = await this.store.listGrants(
      sessionId,
      conversationId,
      participantId,
    );
    if (granted.length === 0) return referenced;
    const allowed = new Set(granted);
    return referenced.filter((resource) => allowed.has(resource.id));
  }
}
