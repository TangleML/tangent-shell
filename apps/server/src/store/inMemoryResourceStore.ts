import { randomUUID } from "node:crypto";

import type {
  CatalogInput,
  Resource,
  ResourceGrant,
  ResourceReference,
  ResourceStore,
} from "./resourceStore.ts";

/** Key of one resource, matching the table's `(session_id, uri)` uniqueness. */
function uriKey(sessionId: string, uri: string): string {
  return `${sessionId}\u0000${uri}`;
}

/** Key of one reference, matching `(conversation_id, resource_id)`. */
function refKey(conversationId: string, resourceId: string): string {
  return `${conversationId}\u0000${resourceId}`;
}

/** Key of one grant, matching `(conversation_id, participant_id, resource_id)`. */
function grantKey(
  conversationId: string,
  participantId: string,
  resourceId: string,
): string {
  return `${conversationId}\u0000${participantId}\u0000${resourceId}`;
}

/**
 * Process-local {@link ResourceStore}, mirroring
 * {@link import("./inMemoryMembershipStore.ts").InMemoryMembershipStore}. For
 * tests and for a bare store with no DB to write to. Insertion order stands in
 * for the `createdAt` ordering the SQLite store gets from its column.
 */
export class InMemoryResourceStore implements ResourceStore {
  /** resource id -> resource, in insertion order. */
  private readonly byId = new Map<string, Resource>();
  /** `(session, uri)` -> resource id, so a re-catalogue keeps the id. */
  private readonly byUri = new Map<string, string>();
  /** `(conversation, resource)` -> reference, in insertion order. */
  private readonly refs = new Map<string, ResourceReference>();
  /** `(conversation, participant, resource)` -> grant, in insertion order. */
  private readonly grants = new Map<string, ResourceGrant>();

  async catalog(input: CatalogInput): Promise<Resource> {
    const key = uriKey(input.sessionId, input.uri);
    const existingId = this.byUri.get(key);
    if (existingId) {
      const prior = this.byId.get(existingId) as Resource;
      const updated: Resource = {
        ...prior,
        kind: input.kind,
        name: input.name,
        authorParticipantId: input.authorParticipantId,
        meta: input.meta,
      };
      this.byId.set(existingId, updated);
      return updated;
    }
    const resource: Resource = {
      id: randomUUID(),
      sessionId: input.sessionId,
      kind: input.kind,
      name: input.name,
      uri: input.uri,
      authorParticipantId: input.authorParticipantId,
      meta: input.meta,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(resource.id, resource);
    this.byUri.set(key, resource.id);
    return resource;
  }

  async catalogIfAbsent(input: CatalogInput): Promise<Resource> {
    const existingId = this.byUri.get(uriKey(input.sessionId, input.uri));
    if (existingId) return this.byId.get(existingId) as Resource;
    return this.catalog(input);
  }

  async remove(sessionId: string, uri: string): Promise<void> {
    const key = uriKey(sessionId, uri);
    const id = this.byUri.get(key);
    if (!id) return;
    this.byUri.delete(key);
    this.byId.delete(id);
    for (const [refId, ref] of this.refs) {
      if (ref.resourceId === id) this.refs.delete(refId);
    }
    for (const [gKey, grant] of this.grants) {
      if (grant.resourceId === id) this.grants.delete(gKey);
    }
  }

  async reference(ref: ResourceReference): Promise<void> {
    const key = refKey(ref.conversationId, ref.resourceId);
    if (!this.refs.has(key)) this.refs.set(key, ref);
  }

  async grant(grant: ResourceGrant): Promise<void> {
    const key = grantKey(
      grant.conversationId,
      grant.participantId,
      grant.resourceId,
    );
    if (!this.grants.has(key)) this.grants.set(key, grant);
  }

  async revoke(grant: ResourceGrant): Promise<void> {
    this.grants.delete(
      grantKey(grant.conversationId, grant.participantId, grant.resourceId),
    );
  }

  async listGrants(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const grant of this.grants.values()) {
      if (grant.sessionId !== sessionId) continue;
      if (grant.conversationId !== conversationId) continue;
      if (grant.participantId !== participantId) continue;
      out.push(grant.resourceId);
    }
    return out;
  }

  async listForSession(sessionId: string): Promise<Resource[]> {
    return [...this.byId.values()].filter(
      (resource) => resource.sessionId === sessionId,
    );
  }

  async listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]> {
    const out: Resource[] = [];
    for (const ref of this.refs.values()) {
      if (ref.sessionId !== sessionId) continue;
      if (ref.conversationId !== conversationId) continue;
      const resource = this.byId.get(ref.resourceId);
      if (resource) out.push(resource);
    }
    return out;
  }
}
