import type {
  CatalogInput,
  Resource,
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

  /** Drops a catalogued resource by `(sessionId, uri)`, cascading references. */
  async remove(sessionId: string, uri: string): Promise<void> {
    await this.store.remove(sessionId, uri);
  }

  /** Every resource referenced in one Conversation. */
  async listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]> {
    return this.store.listForConversation(sessionId, conversationId);
  }
}
