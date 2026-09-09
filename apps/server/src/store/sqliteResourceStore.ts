import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "./db/client.ts";
import {
  resourceGrants,
  resourceReferences,
  type ResourceRow,
  resources,
} from "./db/schema.ts";
import type {
  CatalogInput,
  Resource,
  ResourceGrant,
  ResourceKind,
  ResourceReference,
  ResourceStore,
} from "./resourceStore.ts";

/** Maps a resources row onto the domain {@link Resource}, parsing `meta`. */
function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind as ResourceKind,
    name: row.name,
    uri: row.uri,
    authorParticipantId: row.authorParticipantId ?? undefined,
    meta: parseMeta(row.meta),
    createdAt: row.createdAt,
  };
}

/** Parses the JSON-encoded `meta` column into an object, else undefined. */
function parseMeta(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** SQLite-backed {@link ResourceStore} over the shared session metadata DB. */
export class SqliteResourceStore implements ResourceStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async catalog(input: CatalogInput): Promise<Resource> {
    const meta = input.meta ? JSON.stringify(input.meta) : null;
    const author = input.authorParticipantId ?? null;
    // Re-cataloguing a known (session, uri) refreshes the mutable fields while
    // keeping the original id and createdAt; a new uri inserts a fresh row.
    const row = this.db
      .insert(resources)
      .values({
        id: randomUUID(),
        sessionId: input.sessionId,
        kind: input.kind,
        name: input.name,
        uri: input.uri,
        authorParticipantId: author,
        meta,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [resources.sessionId, resources.uri],
        set: {
          kind: input.kind,
          name: input.name,
          authorParticipantId: author,
          meta,
        },
      })
      .returning()
      .get();
    return toResource(row);
  }

  async catalogIfAbsent(input: CatalogInput): Promise<Resource> {
    const existing = this.db
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.sessionId, input.sessionId),
          eq(resources.uri, input.uri),
        ),
      )
      .get();
    if (existing) return toResource(existing);
    return this.catalog(input);
  }

  async remove(sessionId: string, uri: string): Promise<void> {
    // References cascade on the resource FK, so deleting the row is enough.
    this.db
      .delete(resources)
      .where(and(eq(resources.sessionId, sessionId), eq(resources.uri, uri)))
      .run();
  }

  async reference(ref: ResourceReference): Promise<void> {
    this.db
      .insert(resourceReferences)
      .values({
        sessionId: ref.sessionId,
        conversationId: ref.conversationId,
        resourceId: ref.resourceId,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  async grant(grant: ResourceGrant): Promise<void> {
    this.db
      .insert(resourceGrants)
      .values({
        sessionId: grant.sessionId,
        conversationId: grant.conversationId,
        participantId: grant.participantId,
        resourceId: grant.resourceId,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  async revoke(grant: ResourceGrant): Promise<void> {
    this.db
      .delete(resourceGrants)
      .where(
        and(
          eq(resourceGrants.conversationId, grant.conversationId),
          eq(resourceGrants.participantId, grant.participantId),
          eq(resourceGrants.resourceId, grant.resourceId),
        ),
      )
      .run();
  }

  async listGrants(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<string[]> {
    const rows = this.db
      .select({ resourceId: resourceGrants.resourceId })
      .from(resourceGrants)
      .where(
        and(
          eq(resourceGrants.sessionId, sessionId),
          eq(resourceGrants.conversationId, conversationId),
          eq(resourceGrants.participantId, participantId),
        ),
      )
      .all();
    return rows.map((row) => row.resourceId);
  }

  async listForSession(sessionId: string): Promise<Resource[]> {
    const rows = this.db
      .select()
      .from(resources)
      .where(eq(resources.sessionId, sessionId))
      .orderBy(asc(resources.createdAt))
      .all();
    return rows.map(toResource);
  }

  async listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]> {
    const rows = this.db
      .select({ resource: resources })
      .from(resourceReferences)
      .innerJoin(resources, eq(resourceReferences.resourceId, resources.id))
      .where(
        and(
          eq(resourceReferences.sessionId, sessionId),
          eq(resourceReferences.conversationId, conversationId),
        ),
      )
      .orderBy(asc(resourceReferences.createdAt))
      .all();
    return rows.map((row) => toResource(row.resource));
  }
}
